# ODD SDK

[![NPM](https://img.shields.io/npm/v/@oddjs/odd)](https://www.npmjs.com/package/@oddjs/odd)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://github.com/oddsdk/ts-odd/blob/main/LICENSE)

The ODD SDK empowers developers to build fully distributed web applications without needing a complex back-end. The SDK provides:

- **User accounts** via the browser's [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API) or by using a blockchain wallet as a [ODD plugin](https://github.com/oddsdk/odd-walletauth).
- **Authorization** using [UCAN](https://ucan.xyz/).
- **Encrypted file storage** using [WNFS](https://docs.odd.dev/file-system-wnfs) backed by [IPLD](https://ipld.io/).
- **Key management** using websockets and a two-factor auth-like flow.

ODD applications work offline and store data encrypted for the user by leveraging the power of the web platform. You can read more about the ODD SDK in Fission's [ODD SDK Guide](https://docs.odd.dev). There's also an API reference which can be found at [api.odd.dev](https://api.odd.dev)

# Installation

The `ts-odd` package is published on yarn, pnpm and npm as `@oddjs/odd`:

```bash
npm install @oddjs/odd
```

# Getting started

```ts
// ESM
import * as odd from "@oddjs/odd"

// Browser/UMD build
const odd = globalThis.oddjs
```

## Creating a Program

An ODD program is an assembly of components that make up a distributed web application. Several of the components can be customized. _Let's stick with the default components for now, which means we'll be using the Web Crypto API._

```ts
const program = await odd.program({
  // Can also be a string, used as an identifier for caches.
  // If you're developing multiple apps on the same localhost port,
  // make sure these differ.
  namespace: { creator: "Nullsoft", name: "Winamp" },
}).catch(error => {
  switch (error) {
    case odd.ProgramError.InsecureContext:
      // The ODD SDK requires HTTPS
      break
    case odd.ProgramError.UnsupportedBrowser:
      break
  }
})
```

`odd.program` returns a `Program` object, which can create a new user session or reuse an existing session. There are two ways to create a user session, either by using an authentication strategy or by requesting access from another app through the "capabilities" system. Let's start with the default authentication strategy.

```ts
let session

// Do we have an existing session?
if (program.session) {
  session = program.session

  // If not, let's authenticate.
  // (a) new user, register a new Fission account
} else if (userChoseToRegister) {
  const { success } = await program.auth.register({ username: "llama" })
  session = success ? program.auth.session() : null

  // (b) existing user, link a new device
} else {
  // On device with existing session:
  const producer = await program.auth.accountProducer(program.session.username)

  producer.on("challenge", challenge => {
    // Either show `challenge.pin` or have the user input a PIN and see if they're equal.
    if (userInput === challenge.pin) challenge.confirmPin()
    else challenge.rejectPin()
  })

  producer.on("link", ({ approved }) => {
    if (approved) console.log("Link device successfully")
  })

  // On device without session:
  //     Somehow you'll need to get ahold of the username.
  //     Few ideas: URL query param, QR code, manual input.
  const consumer = await program.auth.accountConsumer(username)

  consumer.on("challenge", ({ pin }) => {
    showPinOnUI(pin)
  })

  consumer.on("link", async ({ approved, username }) => {
    if (approved) {
      console.log(`Successfully authenticated as ${username}`)
      session = await program.auth.session()
    }
  })
}
```

Alternatively you can use the "capabilities" system when you want partial access to a file system. At the moment of writing, capabilities are only supported through the "Fission auth lobby", which is an ODD app that uses the auth strategy shown above.

This Fission auth lobby flow works as follows:

1. You get redirected to the Fission lobby from your app.
2. Here you create an account like in the normal auth strategy flow shown above.
3. The lobby shows what your app wants to access in your file system.
4. You approve or deny these permissions and get redirected back to your app.
5. Your app collects the encrypted information (UCANs & file system secrets).
6. Your app can create a user session.

```ts
// We define a `Permissions` object,
// this represents what permissions to ask the user.
const permissions = {
  // Ask permission to write to and read from the directory:
  // private/Apps/Nullsoft/Winamp
  app: { creator: "Nullsoft", name: "Winamp" },
}

// We need to pass this object to our program
const program = await odd.program({
  namespace: { creator: "Nullsoft", name: "Winamp" },
  permissions,
})

// (a) Whenever you are ready to redirect to the lobby, call this:
program.capabilities.request()

// (b) When you get redirected back and your program is ready,
// you will have access to your user session.
session = program.session
```

Once you have your `Session`, you have access to your file system 🎉

```ts
const fs = session.fs
```

**Notes:**

- You can use alternative authentication strategies, such as [odd-walletauth](https://github.com/oddsdk/odd-walletauth).
- You can remove all traces of the user using `await session.destroy()`
- You can load the file system separately if you're using a web worker. This is done using the combination of `configuration.fileSystem.loadImmediately = false` and `program.fileSystem.load()`
- You can recover a file system if you've downloaded a Recovery Kit by calling `program.fileSystem.recover({ newUsername, oldUsername, readKey })`. The `oldUsername` and `readKey` can be parsed from the uploaded Recovery Kit and the `newUsername` can be generated before calling the function. Please refer to [this example](https://github.com/oddsdk/odd-app-template/blob/5498e7062a4578028b8b55d2ac4c611bd5daab85/src/components/auth/recover/HasRecoveryKit.svelte#L49) from Fission's ODD App Template. Additionally, if you would like to see how to generate a Recovery Kit, you can reference [this example](https://github.com/oddsdk/odd-app-template/blob/main/src/lib/account-settings.ts#L186)

## Working with the file system

See: https://github.com/wnfs-wg/nest/
