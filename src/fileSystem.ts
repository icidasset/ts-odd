import { FileSystem, FileSystemOptions, Modification } from "@wnfs-wg/nest"
import { CID } from "multiformats/cid"

import type { Cabinet } from "./repositories/cabinet.js"

import * as Path from "./path/index.js"
import * as CIDLog from "./repositories/cid-log.js"

import { FileSystemCarrier } from "./common/file-system.js"
import { Maybe } from "./common/index.js"
import { Clerk, Depot, Identifier, Manners, Storage } from "./components.js"
import { Inventory } from "./inventory.js"
import { Names } from "./repositories/names.js"

////////
// 🛠️ //
////////

/**
 * Load a file system.
 */
export async function loadFileSystem(args: {
  cabinet: Cabinet
  carrier: FileSystemCarrier
  dependencies: {
    clerk: Clerk.Implementation
    depot: Depot.Implementation
    identifier: Identifier.Implementation
    manners: Manners.Implementation<FileSystem>
    storage: Storage.Implementation
  }
  names: Names
}): Promise<FileSystem> {
  if (args.carrier.futile) {
    throw new Error(
      "Cannot load a file system using a futile carrier. This usually means you're in the middle of an important process in which the file system cannot be loaded yet."
    )
  }

  // DID is known, so we expect an existing file system.
  if ("did" in args.carrier.id) {
    return loadExisting({
      ...args,
      did: args.carrier.id.did,
    })
  }

  // DID is unknown, that means a new file system.
  return createNew({
    ...args,
    didName: args.carrier.id.name,
  })
}

////////
// ㊙️ //
////////

async function loadExisting(args: {
  cabinet: Cabinet
  carrier: FileSystemCarrier
  dependencies: {
    clerk: Clerk.Implementation
    depot: Depot.Implementation
    identifier: Identifier.Implementation
    manners: Manners.Implementation<FileSystem>
    storage: Storage.Implementation
  }
  did: string
}): Promise<FileSystem> {
  const { cabinet, carrier, dependencies, did } = args
  const { clerk, depot, manners, storage } = dependencies

  let cid: Maybe<CID> = "dataRoot" in carrier ? carrier.dataRoot || null : null

  // Create CIDLog, namespaced by identifier
  const cidLog = await CIDLog.create({ storage, did })

  // Determine the correct CID of the file system to load
  const logIdx = cid ? cidLog.indexOf(cid) : -1

  if (!cid) {
    // No DNS CID yet
    cid = cidLog.newest()
    if (cid) {
      manners.log("📓 Using local CID:", cid.toString())
    } else {
      throw new Error(`Expected a file system to exists for the DID: ${did}`)
    }
  } else if (logIdx === cidLog.length() - 1) {
    // DNS is up to date
    manners.log("📓 DNSLink is up to date:", cid.toString())
  } else if (logIdx !== -1 && logIdx < cidLog.length() - 1) {
    // DNS is outdated
    cid = cidLog.newest()
    const diff = cidLog.length() - 1 - logIdx
    const idxLog = diff === 1 ? "1 newer local entry" : diff.toString() + " newer local entries"
    manners.log("📓 DNSLink is outdated (" + idxLog + "), using local CID:", cid.toString())
  } else {
    // DNS is newer
    await cidLog.add([cid])
    manners.log("📓 DNSLink is newer:", cid.toString())

    // TODO: We could test the filesystem version at this DNSLink at this point to figure out whether to continue locally. However, that needs a plan for reconciling local changes back into the DNSLink, once migrated. And a plan for migrating changes that are only stored locally.
  }

  // File system class instance
  const inventory = new Inventory(clerk, cabinet)

  await manners.fileSystem.hooks.beforeLoadExisting(cid, depot)

  const fs = await FileSystem.fromCID(
    cid,
    options({
      depot,
      did,
      inventory,
    })
  )

  bindEvents({ carrier, cidLog, fs, did, inventory })

  // Mount private nodes
  await Promise.all(
    (cabinet.accessKeys[did] || []).map(async a => {
      return fs.mountPrivateNode({
        path: Path.removePartition(a.path),
        capsuleKey: a.key,
      })
    })
  )

  await manners.fileSystem.hooks.afterLoadExisting(fs, depot)

  return fs
}

async function createNew(args: {
  cabinet: Cabinet
  carrier: FileSystemCarrier
  dependencies: {
    clerk: Clerk.Implementation
    depot: Depot.Implementation
    identifier: Identifier.Implementation
    manners: Manners.Implementation<FileSystem>
    storage: Storage.Implementation
  }
  didName: string
  names: Names
}) {
  const { cabinet, carrier, dependencies, didName, names } = args
  const { clerk, depot, manners, storage } = dependencies

  manners.log("📓 Creating a new file system")

  // Self delegate file system UCAN & add stuff to cabinet
  const fileSystemTicket = await clerk.tickets.fileSystem.origin(
    Path.root(),
    dependencies.identifier.did()
  )

  await cabinet.addTicket("file_system", fileSystemTicket, clerk.tickets.cid)

  // The file system DID is the issuer of the initial file system ticket
  const did = fileSystemTicket.issuer

  await names.add({ name: didName, subject: did })

  // Create CIDLog, namespaced by identifier
  const cidLog = await CIDLog.create({ storage, did })

  // Create new FileSystem instance
  const inventory = new Inventory(clerk, cabinet)

  await manners.fileSystem.hooks.beforeLoadNew(depot)

  const fs = await FileSystem.create(
    options({
      depot,
      did,
      inventory,
    })
  )

  bindEvents({ carrier, cidLog, fs, did, inventory })

  const maybeMount = await manners.fileSystem.hooks.afterLoadNew(fs, depot)

  if (maybeMount) {
    await cabinet.addAccessKey({
      did: did,
      key: maybeMount.capsuleKey,
      path: Path.combine(Path.directory("private"), maybeMount.path),
    })
  }

  // Add initial CID to log
  await cidLog.add([
    await fs.calculateDataRoot(),
  ])

  // Fin
  return fs
}

function options({ depot, did, inventory }: {
  depot: Depot.Implementation
  did: string
  inventory: Inventory
}): FileSystemOptions {
  const blockstore = depot.blockstore

  const onCommit = async (changes: Modification[]): Promise<{ commit: boolean }> => {
    const proofs = await Promise.all(changes.map(change => {
      return inventory.lookupFileSystemTicket(
        change.path,
        did
      )
    }))

    return { commit: proofs.every(a => a !== null) }
  }

  return {
    blockstore,
    onCommit,
  }
}

function bindEvents({ carrier, cidLog, did, fs, inventory }: {
  cidLog: CIDLog.CIDLog
  did: string
  fs: FileSystem
  inventory: Inventory
  carrier: FileSystemCarrier
}): void {
  // Commit
  fs.on("commit", async ({ dataRoot }) => {
    await cidLog.add(dataRoot)
  })

  // Publish
  fs.on("publish", async ({ dataRoot, modifications }: { dataRoot: CID; modifications: Modification[] }) => {
    const proofs = await Promise.all(modifications.map(async mod => {
      const ticket = await inventory.lookupFileSystemTicket(
        mod.path,
        did
      )

      return ticket ? [ticket] : []
    }))

    if (carrier.dataRootUpdater) {
      await carrier.dataRootUpdater(dataRoot, proofs.flat(1))
    }
  })
}
