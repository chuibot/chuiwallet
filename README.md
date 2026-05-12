# Chui Wallet

**Version:** 0.0.1  
**License:** MIT

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

Below is an improved Installation & Available Scripts section with detailed instructions for building, running, and publishing the extension, as well as steps for importing it into Chrome Developer Mode.

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

## Available Scripts

### Cleaning

- **`pnpm clean`**  
  Cleans build outputs, caches, and node_modules.
- **`pnpm clean:install`**  
  Cleans node_modules and reinstalls dependencies.

### Building

- **`pnpm build`**  
  Cleans and builds the project for production. This command compiles TypeScript, bundles JavaScript files, and outputs the final extension package in the `dist/` folder.
- **`pnpm build:firefox`**  
  Builds the project specifically for Firefox, preparing the appropriate build for the Firefox Add-ons Marketplace.

### Development

- **`pnpm dev`**  
  Starts the development environment with hot-reloading, allowing you to see changes in real time.
- **`pnpm dev:firefox`**  
  Starts the development environment tailored for Firefox.

### Linting & Type Checking

- **`pnpm lint`**  
  Runs ESLint to check for code quality issues.
- **`pnpm lint:fix`**  
  Automatically fixes linting issues where possible.
- **`pnpm type-check`**  
  Performs TypeScript type checking to ensure code integrity.

### Packaging & Publishing

- **`pnpm zip`**  
  Zips the production build output for distribution. Use the resulting zip file to publish the extension on the Chrome Web Store.
- **`pnpm zip:firefox`**  
  Zips the Firefox-specific build for submission to the Firefox Add-ons Marketplace.
- **Cutting a release (Changesets):**
  Versions are managed by [Changesets](https://github.com/changesets/changesets). All workspace packages bump together (see `.changeset/config.json`).
    1. While developing, run `pnpm changeset` to record a patch/minor/major bump for `chrome-extension`. Commit the generated `.changeset/*.md` file.
    2. When ready to release, on `main`, run `pnpm version-packages`. This consumes all pending changesets, bumps every workspace package in lockstep, refreshes `pnpm-lock.yaml`, and updates each package's `CHANGELOG.md`. Commit the result.
    3. Tag and push only that tag: `release_tag="v$(node -p "require('./chrome-extension/package.json').version")" && git tag "$release_tag" && git push origin "$release_tag"`.
    4. The release workflow verifies the tag matches `chrome-extension/package.json` before building the zip.
- **Publishing Steps:**
  - **Release artifact must come from green CI.** Do not upload a locally built zip. Push a `v*` tag to trigger `.github/workflows/release.yaml`; that workflow runs `pnpm audit --prod --audit-level=high`, lint, type-check, tests, build, and source-map check, then publishes the zip as a build artifact for download.
  - **Chrome Web Store:**  
    1. Push a `v*` tag and wait for the `Release` workflow to complete on GitHub Actions.
    2. Download the zip artifact from the workflow run.
    3. Log in to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/developer/dashboard).
    4. Click **Add a new item** and upload the artifact zip.
    5. Follow the on-screen instructions to complete your extension listing (provide descriptions, screenshots, etc.).
  - **Firefox Add-ons:**  
    1. Run `pnpm zip:firefox` to generate the Firefox build zip.
    2. Log in to the [Firefox Developer Hub](https://addons.mozilla.org/en-US/developers/).
    3. Click **Submit a New Add-on** and follow the steps to upload your zip file.
    4. Fill in the required details (descriptions, screenshots, privacy policies, etc.) and submit for review.

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

## Additional Notes

- **Hot Reloading:**  
  During development, `pnpm dev` (or `pnpm dev:firefox`) allows live updates as you modify the code.
- **Testing:**  
  Ensure that unit and end-to-end tests pass (integrated with GitHub Actions) before publishing.
- **Configuration:**  
  Wallet-specific settings (like gap limit, network settings, and fiat preferences) can be adjusted in the extension's settings panel or configuration files.

## Contributing

Contributions are welcome! Please review the [CONTRIBUTING.md](CONTRIBUTING.md) file for details on how to contribute to this project.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for more details.
