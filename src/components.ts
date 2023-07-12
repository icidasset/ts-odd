import * as Account from "./components/account/implementation.js"
import * as Agent from "./components/agent/implementation.js"
import * as Channel from "./components/channel/implementation.js"
import * as Depot from "./components/depot/implementation.js"
import * as DNS from "./components/dns/implementation.js"
import * as Identifier from "./components/identifier/implementation.js"
import * as Manners from "./components/manners/implementation.js"
import * as Storage from "./components/storage/implementation.js"

import { FileSystem } from "./fs/class.js"

////////////////
// COMPONENTS //
////////////////

export type Components<Annex extends Account.AnnexParentType> = {
  account: Account.Implementation<Annex>
  agent: Agent.Implementation
  channel: Channel.Implementation
  depot: Depot.Implementation
  dns: DNS.Implementation
  identifier: Identifier.Implementation
  manners: Manners.Implementation<FileSystem>
  storage: Storage.Implementation
}
/////////////////////////
// CONVENIENCE EXPORTS //
/////////////////////////

export { Account, Agent, Channel, Depot, DNS, Identifier, Manners, Storage }
