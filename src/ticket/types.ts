import { CID } from "../common/cid.js"

const CATEGORIES = ["account", "agent", "file_system"] as const

/**
 * A ticket is a [UCAN](https://github.com/ucan-wg/spec) or UCAN-like token.
 * It must have at least an audience and issuer.
 * `token` is the encoded version of the token.
 */
export type Ticket = {
  issuer: string
  audience: string
  token: string
}

/**
 * Ticket category, where is it used?
 */
export type Category = typeof CATEGORIES[number]

export function isCategory(string: string): string is Category {
  return CATEGORIES.includes(string as Category)
}

/**
 * Ticket with context.
 */
export type TicketWithContext = { category: Category; cid: CID; ticket: Ticket }
