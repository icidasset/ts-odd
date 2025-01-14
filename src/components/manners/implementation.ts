import { CID } from "multiformats"

import * as Depot from "../../components/depot/implementation.js"
import { EventEmitter } from "../../events/emitter.js"
import * as Events from "../../events/program.js"
import * as Path from "../../path/index.js"

export type Implementation<FS> = {
  log: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void

  /**
   * File system manners.
   */
  fileSystem: {
    /**
     * Various file system hooks.
     */
    hooks: {
      afterLoadExisting: (fs: FS, depot: Depot.Implementation) => Promise<void>
      afterLoadNew: (fs: FS, depot: Depot.Implementation) => Promise<
        null | {
          path: Path.Distinctive<Path.Segments>
          capsuleKey: Uint8Array
        }
      >
      beforeLoadExisting: (cid: CID, depot: Depot.Implementation) => Promise<void>
      beforeLoadNew: (depot: Depot.Implementation) => Promise<void>
    }
  }

  /**
   * Program manners.
   */
  program: {
    eventEmitter: EventEmitter<Events.Program>

    /**
     * Is the Program online or not?
     */
    online: () => boolean
  }
}
