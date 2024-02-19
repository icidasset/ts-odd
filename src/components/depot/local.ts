import { IDBBlockstore } from "blockstore-idb"
import { CID } from "multiformats/cid"

import { Ticket } from "../../ticket/types.js"
import { Implementation } from "./implementation.js"

// 🛳

export type ImplementationOptions = {
  blockstoreName: string
}

export async function implementation(
  { blockstoreName }: ImplementationOptions
): Promise<Implementation> {
  const blockstore = new IDBBlockstore(blockstoreName)

  // Implementation
  // --------------
  return {
    blockstore,

    // FLUSH

    flush: async (_dataRoot: CID, _proofs: Ticket[]): Promise<void> => {},
  }
}
