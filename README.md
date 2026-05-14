# Chui Wallet

License: MIT. Current version lives in [`chrome-extension/package.json`](chrome-extension/package.json).

Chui is a non-custodial Bitcoin wallet built for merchants, shipped as an open source Chrome extension. It focuses on two pain points that frustrate Blockonomics users and high-volume merchants:

1. **xPub connect.** A standardised in-page button that securely exposes the user's extended public key to merchant payment processors, so there's no copy-pasting xPubs between tabs.
2. **500-address gap limit by default.** Most wallets stop scanning after 20 unused addresses, which can hide funds on busy merchant wallets. Chui scans much deeper, with optimised discovery so performance stays fast even on long histories.

## Features

The project is built with a modular, object-oriented approach using [bitcoinjs-lib](https://github.com/bitcoinjs/bitcoinjs-lib).

1. **Wallet creation and recovery**
   - Secure creation and storage of wallet seed phrases.
   - Viewing of encrypted seed phrases upon password authentication.
   - Wallet recovery using an existing seed phrase.
   - Native SegWit by default, with optional Taproot support.
   - Multiple wallets and accounts.

2. **Balance and transaction history**
   - Communicates with Electrum servers / ElectrumX to fetch the latest balance and transaction history.
   - 500-address gap limit by default for performance on long-history wallets.
   - Displays balance in both Bitcoin and fiat currency (using the Blockonomics price API).

3. **Receive addresses**
   - Automatically returns an unused receiving address.
   - Generates additional addresses up to the gap limit.
   - Lists all previously created addresses.

4. **Sending transactions**
   - Signs transactions securely and broadcasts them via Electrum servers.

5. **Settings**
   - Saves and retrieves wallet settings: gap limit, fiat currency, network (testnet/mainnet), xPub, etc.

6. **Fee estimation**
   - Three fee options (fast, medium, slow) with estimated confirmation times and fees, synced from [mempool.space](https://mempool.space).

7. **Wallet Connect support**
   - Exposes the xPub on demand via the in-page provider, so merchant tools and payment processors can request it with the user's approval.

8. **Security**
   - Follows Chrome extension best practices: minimal permissions, locally-encrypted secrets, password-gated access to sensitive data, no developer backend or telemetry.

## Development

For local setup, build scripts, the release flow, and how to sideload an unpacked build, see [INSTALL.md](INSTALL.md).

## Contributing

Contributions are welcome. Please review the [CONTRIBUTING.md](CONTRIBUTING.md) file for details on how to contribute to this project.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for more details.
