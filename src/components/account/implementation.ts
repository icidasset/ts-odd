import { CID } from "../../common/cid.js"
import { Dictionary as UcanDictionary, Ucan } from "../../ucan/types.js"

////////
// 🧩 //
////////

export type AnnexParentType = Record<string, Function>

export type Implementation<Annex extends AnnexParentType> = {
  /**
   * Additional methods you want to be part of `program.accounts`
   */
  annex: Annex

  // CREATION

  /**
   * Can these form values be used to register an account?
   */
  canRegister: (formValues: Record<string, string>) => Promise<
    { canRegister: true } | { canRegister: false; reason: string }
  >

  /**
   * How to register an account with this account system.
   */
  register: (formValues: Record<string, string>, identifierUcan: Ucan) => Promise<
    { registered: true; ucans: Ucan[] } | { registered: false; reason: string }
  >

  // DATA ROOT

  /**
   * Do we have the ability to update the data root?
   */
  canUpdateDataRoot: (identifierUcans: Ucan[], ucanDictionary: UcanDictionary) => Promise<boolean>

  /**
   * Look up the data root.
   */
  lookupDataRoot: (identifierUcans: Ucan[], ucanDictionary: UcanDictionary) => Promise<CID | null>

  /**
   * How to update the data root, the top-level pointer of the file system.
   */
  updateDataRoot: (dataRoot: CID, proofs: Ucan[]) => Promise<{ updated: true } | { updated: false; reason: string }>

  // UCAN

  /**
   * The DID associated with this account.
   */
  did(identifierUcans: Ucan[], ucanDictionary: UcanDictionary): Promise<string>
}
