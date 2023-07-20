import * as Storage from "../components/storage/implementation"
import * as PrivateRef from "../fs/private-ref.js"
import * as Path from "../path/index.js"
import * as Ucan from "../ucan/index.js"

import { isObject, isString } from "../common/type-checks.js"
import { PrivateReference } from "../fs/types/private-ref"
import Repository, { RepositoryOptions } from "../repository.js"

////////
// 🧩 //
////////

export type CabinetItem =
  | { type: "ucan"; ucan: Ucan.Ucan }
  | { type: "access-key"; key: PrivateReference; path: Path.Distinctive<Path.Segments> } // TODO: Update rs-wnfs, use AccessKey structure

export type CabinetCollection = Record<string, CabinetItem>

////////
// 🛠️ //
////////

export function create({ storage }: { storage: Storage.Implementation }): Promise<Repo> {
  return Repo.create({
    storage,
    storageName: storage.KEYS.CABINET,
  })
}

///////////
// CLASS //
///////////

export { Repo as Cabinet }

export class Repo extends Repository<CabinetCollection, CabinetItem> {
  public accessKeys: { path: Path.Distinctive<Path.Segments>; key: PrivateReference }[]
  public ucansIndexedByAudience: Record<string, Ucan.Ucan[]>
  public ucansIndexedByCID: Record<string, Ucan.Ucan>

  private constructor(options: RepositoryOptions) {
    super(options)
    this.accessKeys = []
    this.ucansIndexedByAudience = {}
    this.ucansIndexedByCID = {}
  }

  // IMPLEMENTATION

  emptyCollection() {
    return {}
  }

  mergeCollections(a: CabinetCollection, b: CabinetCollection): CabinetCollection {
    return {
      ...a,
      ...b,
    }
  }

  async toCollection(item: CabinetItem): Promise<CabinetCollection> {
    switch (item.type) {
      case "access-key":
        return { [Path.toPosix(item.path)]: item }
      case "ucan":
        return { [(await Ucan.cid(item.ucan)).toString()]: item }
    }
  }

  async collectionUpdateCallback(collection: CabinetCollection) {
    const entries = Object.entries(collection)

    this.accessKeys = entries.reduce(
      (acc: { path: Path.Distinctive<Path.Segments>; key: PrivateReference }[], [_k, item]) => {
        if (item.type === "access-key") {
          return [...acc, { path: item.path, key: item.key }]
        } else {
          return acc
        }
      },
      []
    )

    this.ucansIndexedByAudience = entries.reduce(
      (acc: Record<string, Ucan.Ucan[]>, [k, v]) => {
        if (v.type !== "ucan") return acc
        return {
          ...acc,
          [v.ucan.payload.aud]: [...(acc[v.ucan.payload.aud] || []), v.ucan],
        }
      },
      {}
    )

    this.ucansIndexedByCID = entries.reduce(
      (acc: Record<string, Ucan.Ucan>, [k, v]) => {
        if (v.type !== "ucan") return acc
        return {
          ...acc,
          [k]: v.ucan,
        }
      },
      {}
    )
  }

  // ENCODING

  fromJSON(a: string): CabinetCollection {
    const encodedObj = JSON.parse(a)

    return Object.entries(encodedObj).reduce(
      (acc, [k, v]) => {
        return {
          ...acc,
          [k]: decodeItem(v),
        }
      },
      {}
    )
  }

  toJSON(a: CabinetCollection): string {
    const encodedObj = Object.entries(a).reduce(
      (acc, [k, v]) => {
        return {
          ...acc,
          [k]: encodeItem(v),
        }
      },
      {}
    )

    return JSON.stringify(encodedObj)
  }

  // LOOKUPS

  audienceUcans(audience: string): Ucan.Ucan[] {
    return this.ucansIndexedByAudience[audience] || []
  }

  // EXTRA

  addUcan(ucan: Ucan.Ucan): Promise<void> {
    return this.addUcans([ucan])
  }

  addUcans(ucans: Ucan.Ucan[]): Promise<void> {
    return this.add(ucans.map(u => ({ type: "ucan", ucan: u })))
  }

  addAccessKey(item: { path: Path.Distinctive<Path.Segments>; key: PrivateReference }) {
    return this.addAccessKeys([item])
  }

  addAccessKeys(items: { path: Path.Distinctive<Path.Segments>; key: PrivateReference }[]) {
    return this.add(items.map(item => {
      return { type: "access-key", ...item }
    }))
  }

  hasAccessKey(path: Path.Distinctive<Path.Segments>): boolean {
    return !!this.collection[Path.toPosix(path)]
  }
}

//////////////
// ENCODING //
//////////////

export function decodeItem(item: unknown): CabinetItem {
  if (!isObject(item)) throw new Error("Expected the decoded cabinet to be an object")

  switch (item.type) {
    case "access-key":
      if ("key" in item && "path" in item && isObject(item.key) && isString(item.path)) {
        return {
          type: item.type,
          path: Path.fromPosix(item.path),
          key: PrivateRef.decode(item.key as Record<string, string>),
        }
      } else {
        throw new Error("Encoded access-key cabinet-item did not have the expected `key` and `path` attributes")
      }

    case "ucan":
      if ("ucan" in item && isString(item.ucan)) {
        return {
          type: item.type,
          ucan: Ucan.decode(item.ucan),
        }
      } else {
        throw new Error("Encoded ucan cabinet-item did not have the expected `ucan attribute")
      }

    default:
      throw new Error(`Cabinet does not handle the item type '${item.type}'`)
  }
}

export function encodeItem(item: CabinetItem): any {
  switch (item.type) {
    case "access-key":
      return { type: "access-key", key: PrivateRef.encode(item.key), path: Path.toPosix(item.path) }
    case "ucan":
      return { type: "ucan", ucan: Ucan.encode(item.ucan) }
  }
}