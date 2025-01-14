/** @group File System */
import { CID } from "multiformats/cid"

////////
// 🛳️ //
////////

/** @group File System */
export { CID }

////////
// 🏔️ //
////////

/**
 * CID representing an empty string. We use this to speed up DNS propagation
 * However, we treat that as a null value in the code
 */
export const EMPTY_CID = "Qmc5m94Gu7z62RC8waSKkZUrCCBJPyHbkpmGzEePxy2oXJ"

////////
// 🛠️ //
////////

/**
 * Decode a possibly string-encoded CID.
 * Passing an already decoded CID instance works too.
 * @throws Throws an error if a CID cannot be decoded!
 *
 * @group File System
 */
export function decodeCID(val: CID | object | string): CID {
  const cid = CID.asCID(val)
  if (cid) return cid

  // String format
  if (typeof val === "string") return CID.parse(val)

  // Unrecognisable CID
  throw new Error(`Could not decode CID: ${JSON.stringify(val)}`)
}

/**
 * Encode a CID as a string.
 *
 * @group File System
 */
export function encodeCID(cid: CID | string): string {
  return typeof cid === "string" ? cid : cid.toString()
}
