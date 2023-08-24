import * as Identifier from "../identifier/implementation.js"
import * as Provider from "./browser-url/provider.js"
import * as Requestor from "./browser-url/requestor.js"
import * as DefaultClerk from "./clerk/default.js"

import { ProvideResponse, RequestResponse } from "./browser-url/common.js"
import { Implementation } from "./implementation.js"

////////
// 🛳️ //
////////

export { ProvideResponse, RequestResponse } from "./browser-url/common.js"
export { ProvideParams } from "./browser-url/provider.js"
export { RequestParams } from "./browser-url/requestor.js"

export function implementation(
  identifier: Identifier.Implementation
): Implementation<ProvideResponse, RequestResponse> {
  return {
    provide: Provider.provide,
    request: Requestor.request,
    clerk: DefaultClerk.implementation(identifier),
  }
}
