import { Blockstore } from "interface-blockstore"
import { CID } from "multiformats/cid"

import { Inventory } from "../../index.js"
import * as Path from "../../path/index.js"
import { Ticket } from "../../ticket/types.js"

export type Implementation = {
  blockstore: Blockstore

  /**
   * Flush, called when the data root is updated (storage of top-level fs pointer).
   * Here you could set up an IPFS peer connection,
   * or simply push all "changed" blocks to some other block store.
   */
  flush: (dataRoot: CID, proofs: Ticket[], inventory: Inventory) => Promise<void>

  /**
   * Create a permalink to some public file system content.
   *
   * NOTE: This is optional and does not need to be implemented.
   */
  permalink?: (dataRoot: CID, path: Path.Distinctive<Path.Partitioned<Path.Partition>>) => string
}
