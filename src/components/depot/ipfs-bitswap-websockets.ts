import { noise } from "@chainsafe/libp2p-noise"
import { yamux } from "@chainsafe/libp2p-yamux"
import { mplex } from "@libp2p/mplex"
import { webSockets } from "@libp2p/websockets"
import * as filters from "@libp2p/websockets/filters"
import { webTransport } from "@libp2p/webtransport"
import { LevelBlockstore } from "blockstore-level"
import { Blockstore } from "interface-blockstore"
import { Bitswap, createBitswap } from "ipfs-bitswap"
import { Libp2p, createLibp2p } from "libp2p"
import { ping } from "@libp2p/ping"

import { CID } from "multiformats/cid"

import { Maybe } from "../../common/types.js"
import { Manners, Storage } from "../../components.js"
import * as Path from "../../path/index.js"
import { Implementation } from "./implementation.js"

import { Multiaddr } from "@multiformats/multiaddr"
import { Ticket } from "../../ticket/types.js"
import * as Connections from "./ipfs/connections.js"
import * as Peers from "./ipfs/peers.js"

// TRANSPORT

export type Transport = {
  bitswap: Bitswap
  libp2p: Libp2p
}

export async function createTransport<FS>(
  blockstore: Blockstore,
  manners: Manners.Implementation<FS>,
  storage: Storage.Implementation,
  peersUrl: string
): Promise<Transport> {
  const libp2pOptions = {
    connectionEncryption: [noise()],
    streamMuxers: [yamux(), mplex()],
    transports: [
      webSockets({ filter: filters.all }),
      webTransport(),
    ],
    services: {
      ping: ping()
    },
    connectionGater: {
      denyDialMultiaddr: async (multiAddr: Multiaddr) => {
        const str = multiAddr.toString()
        return !str.includes("/ws/") && !str.includes("/wss/") && !str.includes("/webtransport/")
      },
    },
  }

  const libp2p = await createLibp2p(libp2pOptions)

  // Bitswap
  const bitswap = createBitswap(libp2p, blockstore)
  await bitswap.start()

  // Connect to peers
  async function listPeers(): Promise<Multiaddr[]> {
    const peers = await Peers.listPeers(
      storage,
      peersUrl
    )

    return peers.reduce(
      async (acc: Promise<Multiaddr[]>, p) => {
        const a = await acc
        if (await libp2pOptions.connectionGater.denyDialMultiaddr(p) === false) {
          return [...a, p]
        } else {
          return a
        }
      },
      Promise.resolve([])
    )
  }

  const peers = await listPeers()

  peers.forEach(peer => {
    Connections.resetPeerTimeoutsTracking(peer)
    Connections.tryConnecting(libp2p, peer, manners)
  })

  // Try connecting when browser comes online
  manners.program.eventEmitter.on("online", async () => {
    ;(await listPeers())
      .filter(peer => {
        const peerStr = peer.toString()
        return !peerStr.includes("/localhost/")
          && !peerStr.includes("/127.0.0.1/")
          && !peerStr.includes("/0.0.0.0/")
      })
      .forEach(peer => {
        Connections.tryConnecting(libp2p, peer, manners)
      })
  })

  // Fin
  return { bitswap, libp2p }
}

// 🛳

export type ImplementationOptions<FS> = {
  blockstoreName: string
  gatewayUrl: string
  manners: Manners.Implementation<FS>
  peersUrl: string
  storage: Storage.Implementation
}

export async function implementation<FS>(
  { blockstoreName, gatewayUrl, manners, peersUrl, storage }: ImplementationOptions<FS>
): Promise<Implementation> {
  const levelBlockstore = new LevelBlockstore(blockstoreName, { prefix: "" })

  const blockstore: Blockstore = {
    delete: levelBlockstore.delete,
    deleteMany: levelBlockstore.deleteMany,
    getAll: levelBlockstore.getAll,
    getMany: levelBlockstore.getMany,
    has: levelBlockstore.has,
    put: levelBlockstore.put,
    putMany: levelBlockstore.putMany,

    async get(key: CID): Promise<Uint8Array> {
      if (await levelBlockstore.has(key)) return levelBlockstore.get(key)

      // TODO: Can we use CAR files to get a bunch of blocks at once?
      return fetch(`${gatewayUrl.replace(/\/+$/, "")}/ipfs/${key.toString()}?format=raw`)
        .then(r => {
          if (r.ok) return r.arrayBuffer()
          throw new Error("Failed to fetch block from gateway")
        })
        .then(r => new Uint8Array(r))
        .then(async r => {
          await blockstore.put(key, r)
          return r
        })
    },
  }

  // Transport
  // ---------
  let t: Maybe<Transport> = null

  const initiateTransport = async () => {
    if (t) return t
    t = await createTransport(blockstore, manners, storage, peersUrl)
    return t
  }

  // Implementation
  // --------------
  return {
    blockstore,

    // FLUSH

    flush: async (_dataRoot: CID, _proofs: Ticket[]): Promise<void> => {
      if (!manners.program.online()) return
      await initiateTransport()
    },

    // PERMALINK

    permalink: (dataRoot: CID, path: Path.Distinctive<Path.Partitioned<Path.Partition>>) => {
      if (!Path.isPartition("public", path)) {
        throw new Error("Only public paths are supported in this implementation")
      }

      const pathString = Path.toPosix(Path.removePartition(path))
      return `${gatewayUrl}/ipfs/${dataRoot.toString()}/unix/${pathString}`
    },
  }
}
