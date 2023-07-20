import debounce from "debounce-promise"
import { CID } from "multiformats/cid"
import { BlockStore, Namefilter, PrivateDirectory, PrivateFile, PrivateNode, PublicDirectory, PublicFile } from "wnfs"

import type { Cabinet } from "../repositories/cabinet.js"
import type { Repo as CIDLog } from "../repositories/cid-log.js"

import * as Events from "../events.js"
import * as Path from "../path/index.js"
import * as PrivateRefs from "./private-ref.js"
import * as Queries from "./queries.js"
import * as Rng from "./rng.js"
import * as RootTree from "./rootTree.js"
import * as Store from "./store.js"
import * as WASM from "./wasm.js"

import { EventEmitter } from "../events.js"
import { Partition, Partitioned, PartitionedNonEmpty, Private, Public } from "../path/index.js"
import { Ucan } from "../ucan/index.js"
import { searchLatest } from "./common.js"
import { findPrivateNode, partition as determinePartition } from "./mounts.js"
import { TransactionContext } from "./transaction.js"
import {
  AnySupportedDataType,
  DataForType,
  DataRootChange,
  DataType,
  Dependencies,
  DirectoryItem,
  DirectoryItemWithKind,
  FileSystemOptions,
  MutationOptions,
  MutationResult,
  PrivateMutationResult,
  PublicMutationResult,
  PublishingStatus,
  TransactionResult,
} from "./types.js"
import { MountedPrivateNode, MountedPrivateNodes } from "./types/internal.js"
import { PrivateReference } from "./types/private-ref.js"

export class FileSystem {
  #blockStore: BlockStore
  #cabinet: Cabinet
  #cidLog: CIDLog
  #dependencies: Dependencies<FileSystem>
  #eventEmitter: EventEmitter<Events.FileSystem>
  #localOnly: boolean
  #settleTimeBeforePublish: number
  #rootTree: RootTree.RootTree
  #updateDataRoot: (dataRoot: CID, proofs: Ucan[]) => Promise<{ updated: true } | { updated: false; reason: string }>

  #privateNodes: MountedPrivateNodes = {}
  #rng: Rng.Rng

  did: () => Promise<string>

  constructor(
    blockStore: BlockStore,
    cabinet: Cabinet,
    cidLog: CIDLog,
    dependencies: Dependencies<FileSystem>,
    did: () => Promise<string>,
    eventEmitter: EventEmitter<Events.FileSystem>,
    localOnly: boolean,
    settleTimeBeforePublish: number,
    rootTree: RootTree.RootTree,
    updateDataRoot: (dataRoot: CID, proofs: Ucan[]) => Promise<{ updated: true } | { updated: false; reason: string }>
  ) {
    this.#blockStore = blockStore
    this.#cabinet = cabinet
    this.#cidLog = cidLog
    this.#dependencies = dependencies
    this.#eventEmitter = eventEmitter
    this.#localOnly = localOnly
    this.#settleTimeBeforePublish = settleTimeBeforePublish
    this.#rootTree = rootTree
    this.#updateDataRoot = updateDataRoot

    this.#rng = Rng.makeRngInterface()

    this.did = did
  }

  // INITIALISATION
  // --------------

  /**
   * Creates a file system with an empty public tree & an empty private tree at the root.
   */
  static async empty(opts: FileSystemOptions<FileSystem>): Promise<FileSystem> {
    const { cabinet, cidLog, dependencies, did, eventEmitter, localOnly, settleTimeBeforePublish, updateDataRoot } =
      opts

    await WASM.load({ manners: dependencies.manners })

    const blockStore = Store.fromDepot(dependencies.depot)
    const rootTree = RootTree.empty()

    return new FileSystem(
      blockStore,
      cabinet,
      cidLog,
      dependencies,
      did,
      eventEmitter,
      localOnly || false,
      settleTimeBeforePublish || 2500,
      rootTree,
      updateDataRoot
    )
  }

  /**
   * Loads an existing file system from a CID.
   */
  static async fromCID(cid: CID, opts: FileSystemOptions<FileSystem>): Promise<FileSystem> {
    const { cabinet, cidLog, dependencies, did, eventEmitter, localOnly, settleTimeBeforePublish, updateDataRoot } =
      opts

    await WASM.load({ manners: dependencies.manners })

    const blockStore = Store.fromDepot(dependencies.depot)
    const rootTree = await RootTree.fromCID({ blockStore, cid, depot: dependencies.depot })

    return new FileSystem(
      blockStore,
      cabinet,
      cidLog,
      dependencies,
      did,
      eventEmitter,
      localOnly || false,
      settleTimeBeforePublish || 2500,
      rootTree,
      updateDataRoot
    )
  }

  // MOUNTS
  // ------

  async mountPrivateNode(node: {
    path: Path.Distinctive<Path.Segments>
    capsuleRef?: PrivateReference
  }): Promise<{
    path: Path.Distinctive<Path.Segments>
    capsuleRef: PrivateReference
  }> {
    const mounts = await this.mountPrivateNodes([node])
    return mounts[0]
  }

  async mountPrivateNodes(
    nodes: {
      path: Path.Distinctive<Path.Segments>
      capsuleRef?: PrivateReference
    }[]
  ): Promise<{
    path: Path.Distinctive<Path.Segments>
    capsuleRef: PrivateReference
  }[]> {
    const newNodes = await Promise.all(
      nodes.map(async ({ path, capsuleRef }): Promise<[string, MountedPrivateNode]> => {
        let privateNode: PrivateNode

        if (capsuleRef) {
          const ref = PrivateRefs.toWnfsRef(capsuleRef)
          privateNode = await PrivateNode.load(ref, this.#rootTree.privateForest, this.#blockStore)
        } else {
          privateNode = Path.isFile(path)
            ? new PrivateFile(new Namefilter(), new Date(), this.#rng).asNode()
            : new PrivateDirectory(new Namefilter(), new Date(), this.#rng).asNode()
        }

        return [
          // Use absolute paths so that you can retrieve the root: privateNodes["/"]
          Path.toPosix(path, { absolute: true }),
          { node: privateNode, path },
        ]
      })
    )

    this.#privateNodes = {
      ...this.#privateNodes,
      ...Object.fromEntries(newNodes),
    }

    return Promise.all(
      newNodes.map(async ([_, n]: [string, MountedPrivateNode]) => {
        const storeResult = await n.node.store(this.#rootTree.privateForest, this.#blockStore, this.#rng)
        const [privateRef, privateForest] = storeResult

        this.#rootTree = { ...this.#rootTree, privateForest }

        return {
          path: n.path,
          capsuleRef: PrivateRefs.fromWnfsRef(privateRef),
        }
      })
    )
  }

  unmountPrivateNode(path: Path.Distinctive<Path.Segments>): void {
    delete this.#privateNodes[Path.toPosix(path)]
  }

  // QUERY
  // -----

  async contentCID(path: Path.File<Partitioned<Public>>): Promise<CID | null> {
    return this.#transactionContext().contentCID(path)
  }

  async capsuleCID(path: Path.Distinctive<Partitioned<Public>>): Promise<CID | null> {
    return this.#transactionContext().capsuleCID(path)
  }

  async capsuleRef(path: Path.Distinctive<Partitioned<Private>>): Promise<PrivateReference | null> {
    return this.#transactionContext().capsuleRef(path)
  }

  async exists(path: Path.Distinctive<Partitioned<Partition>>): Promise<boolean> {
    return this.#transactionContext().exists(path)
  }

  async listDirectory(
    path: Path.Directory<Partitioned<Partition>>,
    listOptions: { withItemKind: true }
  ): Promise<DirectoryItemWithKind[]>
  async listDirectory(
    path: Path.Directory<Partitioned<Partition>>,
    listOptions: { withItemKind: false }
  ): Promise<DirectoryItem[]>
  async listDirectory(
    path: Path.Directory<Partitioned<Partition>>
  ): Promise<DirectoryItem[]>
  async listDirectory(
    path: Path.Directory<Partitioned<Partition>>,
    listOptions: { withItemKind: boolean } = { withItemKind: false }
  ): Promise<DirectoryItem[] | DirectoryItemWithKind[]> {
    return this.#transactionContext().listDirectory(path, listOptions)
  }

  ls = this.listDirectory

  async read<
    D extends DataType,
    V = unknown,
  >(
    path: Path.File<PartitionedNonEmpty<Partition>> | { contentCID: CID } | { capsuleCID: CID } | {
      capsuleRef: PrivateReference
    },
    dataType: D,
    options?: { offset: number; length: number }
  ): Promise<DataForType<D, V>>
  async read<V = unknown>(
    path: Path.File<PartitionedNonEmpty<Partition>> | { contentCID: CID } | { capsuleCID: CID } | {
      capsuleRef: PrivateReference
    },
    dataType: DataType,
    options?: { offset: number; length: number }
  ): Promise<AnySupportedDataType<V>> {
    return this.#transactionContext().read<DataType, V>(path, dataType, options)
  }

  // MUTATIONS
  // ---------

  async copy<From extends Partition, To extends Partition>(
    from: Path.Distinctive<PartitionedNonEmpty<From>>,
    to: Path.File<PartitionedNonEmpty<To>> | Path.Directory<Partitioned<To>>,
    mutationOptions?: MutationOptions
  ): Promise<MutationResult<To>>
  async copy(
    from: Path.Distinctive<PartitionedNonEmpty<Partition>>,
    to: Path.File<PartitionedNonEmpty<Partition>> | Path.Directory<Partitioned<Partition>>,
    mutationOptions: MutationOptions = {}
  ): Promise<MutationResult<Partition> | null> {
    return this.#infusedTransaction(
      t => t.copy(from, to),
      to,
      mutationOptions
    )
  }

  cp = this.copy

  async createDirectory<P extends Partition>(
    path: Path.Directory<PartitionedNonEmpty<P>>,
    mutationOptions?: MutationOptions
  ): Promise<MutationResult<P> & { path: Path.Directory<PartitionedNonEmpty<Partition>> }>
  async createDirectory(
    path: Path.Directory<PartitionedNonEmpty<Partition>>,
    mutationOptions: MutationOptions = {}
  ): Promise<MutationResult<Partition> & { path: Path.Directory<PartitionedNonEmpty<Partition>> }> {
    let finalPath = path

    const mutationResult = await this.#infusedTransaction(
      async t => {
        const creationResult = await t.createDirectory(path)
        finalPath = creationResult.path
      },
      path,
      mutationOptions
    )

    return {
      ...mutationResult,
      path: finalPath,
    }
  }

  async createFile<
    P extends Partition,
    D extends DataType,
    V = unknown,
  >(
    path: Path.File<PartitionedNonEmpty<P>>,
    dataType: DataType,
    data: DataForType<D, V>,
    mutationOptions?: MutationOptions
  ): Promise<MutationResult<P> & { path: Path.File<PartitionedNonEmpty<Partition>> }>
  async createFile<
    D extends DataType,
    V = unknown,
  >(
    path: Path.File<PartitionedNonEmpty<Partition>>,
    dataType: DataType,
    data: DataForType<D, V>,
    mutationOptions: MutationOptions = {}
  ): Promise<MutationResult<Partition> & { path: Path.File<PartitionedNonEmpty<Partition>> }> {
    let finalPath = path

    const mutationResult = await this.#infusedTransaction(
      async t => {
        const creationResult = await t.createFile(path, dataType, data)
        finalPath = creationResult.path
      },
      path,
      mutationOptions
    )

    return {
      ...mutationResult,
      path: finalPath,
    }
  }

  async ensureDirectory<P extends Partition>(
    path: Path.Directory<PartitionedNonEmpty<P>>,
    mutationOptions?: MutationOptions
  ): Promise<MutationResult<P>>
  async ensureDirectory(
    path: Path.Directory<PartitionedNonEmpty<Partition>>,
    mutationOptions: MutationOptions = {}
  ): Promise<MutationResult<Partition>> {
    return this.#infusedTransaction(
      t => t.ensureDirectory(path),
      path,
      mutationOptions
    )
  }

  mkdir = this.ensureDirectory

  async move<From extends Partition, To extends Partition>(
    from: Path.Distinctive<PartitionedNonEmpty<From>>,
    to: Path.File<PartitionedNonEmpty<To>> | Path.Directory<Partitioned<To>>,
    mutationOptions?: MutationOptions
  ): Promise<MutationResult<To>>
  async move(
    from: Path.Distinctive<PartitionedNonEmpty<Partition>>,
    to: Path.File<PartitionedNonEmpty<Partition>> | Path.Directory<Partitioned<Partition>>,
    mutationOptions: MutationOptions = {}
  ): Promise<MutationResult<Partition>> {
    return this.#infusedTransaction(
      t => t.move(from, to),
      to,
      mutationOptions
    )
  }

  mv = this.move

  async remove(
    path: Path.Distinctive<PartitionedNonEmpty<Partition>>,
    mutationOptions: MutationOptions = {}
  ): Promise<DataRootChange> {
    const transactionResult = await this.transaction(
      t => t.remove(path),
      mutationOptions
    )

    return {
      dataRoot: transactionResult.dataRoot,
      publishingStatus: transactionResult.publishingStatus,
    }
  }

  rm = this.remove

  async rename<P extends Partition>(
    path: Path.Distinctive<PartitionedNonEmpty<P>>,
    newName: string,
    mutationOptions?: MutationOptions
  ): Promise<MutationResult<P>>
  async rename(
    path: Path.Distinctive<PartitionedNonEmpty<Partition>>,
    newName: string,
    mutationOptions: MutationOptions = {}
  ): Promise<MutationResult<Partition>> {
    return this.#infusedTransaction(
      t => t.rename(path, newName),
      Path.replaceTerminus(path, newName),
      mutationOptions
    )
  }

  async write<
    P extends Partition,
    D extends DataType,
    V = unknown,
  >(
    path: Path.File<PartitionedNonEmpty<P>>,
    dataType: DataType,
    data: DataForType<D, V>,
    mutationOptions?: MutationOptions
  ): Promise<MutationResult<P>>
  async write<
    D extends DataType,
    V = unknown,
  >(
    path: Path.File<PartitionedNonEmpty<Partition>>,
    dataType: DataType,
    data: DataForType<D, V>,
    mutationOptions: MutationOptions = {}
  ): Promise<MutationResult<Partition>> {
    return this.#infusedTransaction(
      t => t.write(path, dataType, data),
      path,
      mutationOptions
    )
  }

  // TRANSACTIONS
  // ------------

  async transaction(
    handler: (t: TransactionContext<FileSystem>) => Promise<void>,
    mutationOptions: MutationOptions = {}
  ): Promise<TransactionResult> {
    const context = this.#transactionContext()

    // Execute handler
    await handler(context)

    // Commit transaction
    const { changedPaths, privateNodes, proofs, rootTree } = await TransactionContext.commit(context)

    this.#privateNodes = privateNodes
    this.#rootTree = rootTree

    // Determine data root
    const dataRoot = await this.calculateDataRoot()

    // Emit events
    changedPaths.forEach(changedPath => {
      this.#eventEmitter.emit("fileSystem:local-change", {
        dataRoot,
        path: changedPath,
      })
    })

    // Publish
    const signal = mutationOptions.skipPublish === true
      ? Promise.resolve(FileSystem.#statusNotPublishing)
      : this.#publish(dataRoot, proofs)

    // Fin
    return {
      changedPaths,
      dataRoot,
      publishingStatus: signal,
    }
  }

  // 🛠️

  calculateDataRoot(): Promise<CID> {
    return RootTree.store({
      blockStore: this.#blockStore,
      depot: this.#dependencies.depot,
      rootTree: this.#rootTree,
    })
  }

  // ㊙️  ▒▒  MUTATIONS

  async #infusedTransaction(
    handler: (t: TransactionContext<FileSystem>) => Promise<void>,
    path: Path.Distinctive<Partitioned<Public>>,
    mutationOptions?: MutationOptions
  ): Promise<PublicMutationResult>
  async #infusedTransaction(
    handler: (t: TransactionContext<FileSystem>) => Promise<void>,
    path: Path.Distinctive<Partitioned<Private>>,
    mutationOptions?: MutationOptions
  ): Promise<PrivateMutationResult>
  async #infusedTransaction(
    handler: (t: TransactionContext<FileSystem>) => Promise<void>,
    path: Path.Distinctive<Partitioned<Partition>>,
    mutationOptions?: MutationOptions
  ): Promise<MutationResult<Partition>>
  async #infusedTransaction(
    handler: (t: TransactionContext<FileSystem>) => Promise<void>,
    path: Path.Distinctive<Partitioned<Partition>>,
    mutationOptions: MutationOptions = {}
  ): Promise<MutationResult<Partition>> {
    const transactionResult = await this.transaction(handler, mutationOptions)
    const partition = determinePartition(path)

    switch (partition.name) {
      case "public": {
        const node = partition.segments.length === 0
          ? this.#rootTree.publicRoot.asNode()
          : await this.#rootTree.publicRoot.getNode(partition.segments, this.#blockStore)
        if (!node) throw new Error("Failed to find needed public node for infusion")

        const fileOrDir: PublicFile | PublicDirectory = node.isFile() ? node.asFile() : node.asDir()

        const capsuleCID = await fileOrDir.store(this.#blockStore).then(a => CID.decode(a))
        const contentCID = node.isFile() ? CID.decode(node.asFile().contentCid()) : capsuleCID

        return {
          dataRoot: transactionResult.dataRoot,
          publishingStatus: transactionResult.publishingStatus,
          capsuleCID,
          contentCID,
        }
      }

      case "private": {
        const priv = findPrivateNode(partition.path, this.#privateNodes)
        const capsuleRef = priv.node.isFile()
          ? await priv.node
            .asFile()
            .store(this.#rootTree.privateForest, this.#blockStore, this.#rng)
          : await (
            priv.remainder.length === 0
              ? Promise.resolve(priv.node)
              : priv.node
                .asDir()
                .getNode(priv.remainder, searchLatest(), this.#rootTree.privateForest, this.#blockStore)
          )
            .then(node => {
              if (!node) throw new Error("Failed to find needed private node for infusion")
              return node.store(this.#rootTree.privateForest, this.#blockStore)
            })
            .then(([ref]) => ref)

        return {
          dataRoot: transactionResult.dataRoot,
          publishingStatus: transactionResult.publishingStatus,
          capsuleRef: PrivateRefs.fromWnfsRef(capsuleRef),
        }
      }
    }
  }

  #transactionContext(): TransactionContext<FileSystem> {
    return new TransactionContext(
      this.#blockStore,
      this.#cabinet,
      this.#dependencies,
      this.did,
      { ...this.#privateNodes },
      this.#rng,
      { ...this.#rootTree }
    )
  }

  // ㊙️  ▒▒  PUBLISHING

  static #statusNotPublishing: PublishingStatus = {
    persisted: false,
    reason: "DISABLED_BY_OPTIONS",
  }

  #debouncedDataRootUpdate = debounce(
    async (args: [dataRoot: CID, proofs: Ucan[]][]): Promise<PublishingStatus[]> => {
      const [dataRoot, proofs] = args[args.length - 1]

      await this.#dependencies.depot.flush(dataRoot, proofs)

      const { updated } = await this.#updateDataRoot(
        dataRoot,
        proofs
      )

      let status: PublishingStatus

      if (updated) {
        this.#eventEmitter.emit("fileSystem:publish", { dataRoot })
        status = { persisted: true, localOnly: false }
      } else {
        status = { persisted: false, reason: "DATA_ROOT_UPDATE_FAILED" }
      }

      return args.map(_ => status)
    },
    (() => this.#settleTimeBeforePublish) as any,
    {
      accumulate: true,
      leading: false,
    }
  )

  /**
   * Updates the user's data root if it can find a UCAN that allows them to do so.
   */
  async #publish(
    dataRoot: CID,
    proofs: Ucan[]
  ): Promise<PublishingStatus> {
    await this.#cidLog.add([dataRoot])

    if (this.#localOnly) return { persisted: true, localOnly: true }
    const debounceResult = await this.#debouncedDataRootUpdate(dataRoot, proofs)

    // The type of `debounceResult` is not correct, issue with `@types/debounce-promise`
    return debounceResult as unknown as PublishingStatus
  }

  // ㊙️

  publicContext(): Queries.PublicContext<FileSystem> {
    return {
      blockStore: this.#blockStore,
      dependencies: this.#dependencies,
      rootTree: this.#rootTree,
    }
  }

  privateContext(): Queries.PrivateContext {
    return {
      blockStore: this.#blockStore,
      privateNodes: this.#privateNodes,
      rng: this.#rng,
      rootTree: this.#rootTree,
    }
  }
}