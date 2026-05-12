# Chui Wallet

License: MIT. Current version lives in [`chrome-extension/package.json`](chrome-extension/package.json).

Chui is a non-custodial Bitcoin wallet built specifically for merchants. It is implemented as an open source Chrome extension that emphasizes security, performance, and a clean user experience.

## Summary

Chui Wallet provides a streamlined interface for managing Bitcoin transactions. It is designed to quickly display balances and transaction histories by implementing a default BIP32 gap limit of 500, ensuring fast performance even for wallets with a long history.

## Core Functionality

The project is built with a modular, object-oriented approach using [bitcoinjs-lib](https://github.com/bitcoinjs/bitcoinjs-lib). It includes interfaces and implementations for the following features:

1. **Wallet Creation/Recovery:**  
   - Secure creation and storage of wallet seed phrases.  
   - Viewing of encrypted seed phrases upon password authentication.  
   - Wallet recovery using an existing seed phrase.  
   - Native SegWit wallet support by default with optional Taproot support.  
   - Support for multiple wallets/accounts.

2. **Wallet Balance/Transaction History:**  
   - Communicates with Electrum servers/ElectrumX to fetch the latest balance and transaction history.  
   - Implements a 500 transaction gap limit to ensure high performance.  
   - Displays balance in both Bitcoin and fiat currency (using Blockonomics price API).

3. **Receive Address Creation:**  
   - Automatically returns an unused receiving address.  
   - Allows users to generate additional addresses until the gap limit is reached.  
   - Provides a list of all previously created addresses.

4. **Sending Transactions:**  
   - Signs transactions securely and broadcasts them via Electrum servers.

5. **Settings:**  
   - Allows saving and retrieval of wallet settings including gap limit, fiat currency preference, network (testnet/mainnet), extended public key (xpub), etc.

6. **Fee Estimation:**  
   - Provides three fee options (fast, medium, slow) with estimated confirmation times and fees.  
   - Fee estimation data is synced from APIs like [mempool.space](http://mempool.space).

7. **Wallet Connect Support:**  
   - Enables wallet connect functionality to provide xpub as needed.

8. **High Security Standards:**  
   - High emphasis on wallet security by following best practices and Chrome extension coding guidelines.

## Installation and Setup

### Prerequisites

- **Node.js:** Version 22.13.1 or above.
- **pnpm:** [pnpm package manager](https://pnpm.io/).

### Cloning and Installing Dependencies

Clone the repository and install dependencies:

```bash
git clone https://github.com/chuibot/chuiwallet.git
cd chuiwallet
pnpm install
```

## Scripts

All scripts run from the repo root. Turbo fans them out to every workspace that defines the matching script.

### Cleaning

- `pnpm clean` removes `dist/`, turbo caches, and every `node_modules`.
- `pnpm clean:install` runs `clean` then `pnpm install --frozen-lockfile`.

### Building

- `pnpm build` produces the Chrome production build under `dist/`.
- `pnpm build:firefox` produces the Firefox build.

### Development

- `pnpm dev` starts the watch build with HMR for Chrome.
- `pnpm dev:firefox` does the same for Firefox.

### Lint, type-check, test

- `pnpm lint:check` runs ESLint across every workspace (read-only).
- `pnpm lint` / `pnpm lint:fix` run ESLint with `--fix`.
- `pnpm type-check` runs `tsc --noEmit` in every workspace.
- `pnpm test` runs the `test` script in every workspace that has one. Today that is just `@extension/backend` (Jest).

### Packaging

- `pnpm zip` builds Chrome, then writes the store zip to `dist-zip/`.
- `pnpm zip:firefox` does the same for Firefox.

## Cutting a release

Versions are managed by [Changesets](https://github.com/changesets/changesets). Every workspace package is in the `fixed` group, so they all bump together (see [`.changeset/config.json`](.changeset/config.json)). The `chrome-extension` version is what ends up in the manifest.

1. As part of a change, run `pnpm changeset`, pick `patch` / `minor` / `major` against `chrome-extension`, and write a one-line summary. Commit the generated `.changeset/*.md` alongside the rest of the change.
2. When the queued changesets are ready to ship, on `main`:

   ```bash
   pnpm version-packages
   ```

   That eats the pending changesets, bumps every workspace `package.json`, refreshes `pnpm-lock.yaml`, and writes a `CHANGELOG.md` entry per package. Commit the result. (Don't use `pnpm version` directly: that's the built-in pnpm command, not this script.)
3. Tag and push only the new tag:

   ```bash
   release_tag="v$(node -p "require('./chrome-extension/package.json').version")"
   git tag "$release_tag"
   git push origin "$release_tag"
   ```

The `Release` workflow ([`.github/workflows/release.yaml`](.github/workflows/release.yaml)) then:

- refuses to run if the tag isn't reachable from `main`,
- refuses to run if the tag doesn't match `chrome-extension/package.json`,
- runs `pnpm audit --prod --audit-level=high`, lint, type-check, `pnpm test`, build, and a source-map check,
- uploads `chuiwallet-vX.Y.Z.zip` as a workflow artifact.

## Publishing

Always download the zip artifact from the green release workflow run. Do not upload a locally built zip.

**Chrome Web Store:** [Developer Dashboard](https://chrome.google.com/webstore/developer/dashboard) > Add a new item > upload the artifact zip.

**Firefox Add-ons:** for Firefox the release workflow currently only zips Chrome. Run `pnpm zip:firefox` locally on the release commit, then upload the resulting zip at the [Developer Hub](https://addons.mozilla.org/en-US/developers/) > Submit a New Add-on.

## Running the Extension in Chrome

1. **Build the Extension:**  
   Run the production build:

   ```bash
   pnpm build
   ```

   This creates the production-ready files in the `dist/` folder.

2. **Load the Extension in Chrome:**  
   - Open Chrome and navigate to `chrome://extensions/`.
   - Enable **Developer mode** using the toggle in the top right corner.
   - Click **Load unpacked**.
   - Select the `dist/` folder from your project.
   - The extension will load and appear in your list of installed extensions.

## Contributing

Contributions are welcome! Please review the [CONTRIBUTING.md](CONTRIBUTING.md) file for details on how to contribute to this project.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for more details.
