# Installing and developing Chui Wallet

This document covers local development, the build and release workflow, and how to sideload an unpacked build into Chrome. For the product overview and feature list, see [README.md](README.md).

## Prerequisites

- **Node.js:** Version 22.13.1 or above.
- **pnpm:** [pnpm package manager](https://pnpm.io/).

## Cloning and installing dependencies

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

From a clean `main` that's in sync with `origin/main`:

```bash
pnpm release:patch    # 1.0.0 -> 1.0.1
pnpm release:minor    # 1.0.0 -> 1.1.0
pnpm release:major    # 1.0.0 -> 2.0.0
```

[`scripts/release.mjs`](scripts/release.mjs) bumps every workspace `package.json` to the new version, refreshes `pnpm-lock.yaml`, commits `Release vX.Y.Z`, tags `vX.Y.Z`, and pushes the branch + tag. It bails if the working tree is dirty or `main` isn't in sync with `origin/main`.

The `vX.Y.Z` push triggers [`.github/workflows/release.yaml`](.github/workflows/release.yaml), which:

- refuses to run if the tag isn't reachable from `main`,
- refuses to run if the tag doesn't match `chrome-extension/package.json`,
- runs `pnpm audit --prod --audit-level=high`, lint, type-check, `pnpm test`, build, and a source-map check,
- zips `dist/` into `dist-zip/chuiwallet-vX.Y.Z.zip`,
- creates a GitHub Release with the zip attached and auto-generated notes.

## Publishing

Grab the zip from the [Releases page](https://github.com/chuibot/chuiwallet/releases) (do not upload a locally built zip).

**Chrome Web Store:** [Developer Dashboard](https://chrome.google.com/webstore/developer/dashboard) > Add a new item > upload the zip from the release.

**Firefox Add-ons:** the workflow currently only zips Chrome. For Firefox, check out the release tag locally, run `pnpm zip:firefox`, then upload the resulting zip at the [Developer Hub](https://addons.mozilla.org/en-US/developers/) > Submit a New Add-on.

## Running the unpacked extension in Chrome

1. **Build the extension.**
   Run the production build:

   ```bash
   pnpm build
   ```

   This creates the production-ready files in the `dist/` folder.

2. **Load the extension in Chrome.**
   - Open Chrome and navigate to `chrome://extensions/`.
   - Enable **Developer mode** using the toggle in the top right corner.
   - Click **Load unpacked**.
   - Select the `dist/` folder from your project.
   - The extension will load and appear in your list of installed extensions.
