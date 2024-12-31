# Chui Bitcoin Wallet – Production-Style Offline Codebase

**Chui** is a non-custodial Bitcoin wallet for merchants, designed to run as a browser extension.  
It supports:  

1. **Multiple address types** (P2PKH, P2SH-P2WPKH, P2WPKH, P2TR)  
2. **Mainnet / Testnet** switching (stored in IndexedDB settings)  
3. **Encrypted mnemonic** in IndexedDB (AES-256-CBC with user password)  
4. **Electrum** connectivity for scanning addresses, fetching balances, transaction history, UTXOs  
5. **Full gap-limit scanning** to find new addresses up to 20 consecutive empties or 500 total  
6. **PSBT** building, signing, broadcasting for transactions using the discovered UTXOs  
7. **Complete test coverage** with Jest (unit + integration)

## Installation

```bash
npm install
npm run build
npm run test