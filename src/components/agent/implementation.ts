import type { KeyType, SignatureAlgorithm } from "iso-did/types"

export type Implementation = {
  /**
   * Key pair used to make exchanges
   * (eg. make an encrypted exchange)
   */
  exchangeKey: () => Promise<CryptoKeyPair>

  /**
   * Key pair used to sign data.
   */
  signingKey: () => Promise<CryptoKeyPair>

  /**
   * DID associated with this agent.
   */
  did: () => Promise<string>

  /**
   * Decrypt something with the exchange key.
   */
  decrypt: (data: Uint8Array) => Promise<Uint8Array>

  /**
   * Encrypt something with the exchange key.
   */
  encrypt: (data: Uint8Array) => Promise<Uint8Array>

  /**
   * Sign something with the signing key.
   */
  sign: (data: Uint8Array) => Promise<Uint8Array>

  /**
   * This goes hand in hand with the DID `keyTypes` record from the crypto component.
   */
  keyAlgorithm: () => Promise<KeyType>

  /**
   * The JWT algorithm string for agent UCANs.
   */
  ucanAlgorithm: () => Promise<SignatureAlgorithm>
}