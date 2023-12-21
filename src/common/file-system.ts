import { Ticket } from "../ticket/types.js"
import { CID } from "./cid.js"

/** @group File System */
export type DataRootUpdater = (
  dataRoot: CID,
  proofs: Ticket[]
) => Promise<{ updated: true } | { updated: false; reason: string }>

/** @group File System */
export type FileSystemCarrier = {
  dataRoot?: CID
  dataRootUpdater?: DataRootUpdater
  futile?: boolean
  id: { did: string } | { name: string }
}
