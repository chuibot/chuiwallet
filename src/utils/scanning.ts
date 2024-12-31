import { getMnemonic } from "../modules/wallet";
import { getWalletSettings } from "../settings/walletSettings";
import * as bitcoin from "bitcoinjs-lib";
import { deriveAddress } from "./index";
import ElectrumClient from "electrum-client";
import { ELECTRUM_MAINNET, ELECTRUM_TESTNET } from "../config";
import { addressToScriptHash } from "../electrum/scriptHash";

/**
 * We'll store the derivation path in the UTXO so we can sign it later.
 */
export interface UTXO {
  txId: string;
  vout: number;
  value: number;
  address: string;
  scriptPubKey: string;
  height?: number;
  derivationPath: string;
}

/**
 * Connect to the correct Electrum server
 */
async function connectElectrum() {
  const settings = await getWalletSettings();
  const conf =
    settings.network === "mainnet" ? ELECTRUM_MAINNET : ELECTRUM_TESTNET;
  const client = new ElectrumClient(conf.port, conf.host, conf.protocol);
  await client.connect("ChuiWalletScanner", "1.4");
  return client;
}

/**
 * fetchUTXOsForAddress:
 * calls electrumClient.blockchainScripthash_listunspent(scriptHash)
 */
async function fetchUTXOsForAddress(
  addr: string,
  network: bitcoin.networks.Network
): Promise<
  { tx_hash: string; tx_pos: number; height: number; value: number }[]
> {
  const client = await connectElectrum();
  try {
    const scripthash = addressToScriptHash(addr, network);
    const unspent = await client.blockchainScripthash_listunspent(scripthash);
    return unspent;
  } finally {
    await client.close();
  }
}

/**
 * Scans external addresses from m/purpose'/coinType'/account'/0/i
 * until 'gapLimit' consecutive empties or 'maxAddresses' total.
 * Returns all derived addresses and UTXOs for them.
 */
export async function scanAddressesUntilGapReached(
  walletId: string,
  password: string
): Promise<{
  addresses: {
    address: string;
    derivationPath: string;
  }[];
  allUTXOs: UTXO[];
}> {
  const settings = await getWalletSettings();
  const netObj =
    settings.network === "mainnet"
      ? bitcoin.networks.bitcoin
      : bitcoin.networks.testnet;

  const mnemonic = await getMnemonic(walletId, password);
  const addresses: { address: string; derivationPath: string }[] = [];
  const allUTXOs: UTXO[] = [];

  let consecutiveEmpty = 0;
  let i = 0;

  while (i < settings.maxAddresses && consecutiveEmpty < settings.gapLimit) {
    const derived = deriveAddress(mnemonic, 0, i, false, settings);
    const unspent = await fetchUTXOsForAddress(derived.address, netObj);

    if (unspent.length === 0) {
      consecutiveEmpty++;
    } else {
      consecutiveEmpty = 0;

      // Convert each unspent to our UTXO type
      for (const u of unspent) {
        // We create the actual scriptPubKey buffer from the address
        // simpler approach => re-run addressToScriptHash decode? We'll do a direct approach:

        // Because we might need the actual scriptPubKey:
        // We can re-encode for signing. The electrum approach doesn't return scriptPubKey,
        // so we generate it using scriptHash logic in reverse.
        // But let's do a simple approach:
        // We'll build a raw scriptPubKey for this address using the scriptHash module logic.
        // Actually, let's do the correct approach from the address:

        // In practice, we'd do the same logic as scriptHash => scriptPubKey.
        // We'll re-run code from scriptHash, but that was partial. Let's do a direct approach:
        const scriptPubKey = buildScriptPubKey(derived.address, netObj);
        allUTXOs.push({
          txId: u.tx_hash,
          vout: u.tx_pos,
          value: u.value,
          address: derived.address,
          scriptPubKey: scriptPubKey.toString("hex"),
          height: u.height,
          derivationPath: derived.derivationPath,
        });
      }
    }
    addresses.push(derived);
    i++;
  }

  return { addresses, allUTXOs };
}

/**
 * Build scriptPubKey from an address, supporting P2PKH, P2SH, P2WPKH, P2TR.
 */
function buildScriptPubKey(
  address: string,
  network: bitcoin.networks.Network
): Buffer {
  // We'll reuse logic from scriptHash, except we won't do the final sha256+reverse. We just need the raw script.
  try {
    const { version, data } = bitcoin.address.fromBech32(address);
    if (version === 0 && data.length === 20) {
      // P2WPKH => OP_0 <20-byte>
      return bitcoin.script.compile([0x00, data]);
    } else if (version === 1 && data.length === 32) {
      // P2TR => OP_1 <32-byte>
      return bitcoin.script.compile([0x51, data]);
    } else {
      // Possibly P2WSH, etc.
      return bitcoin.script.compile([version, data]);
    }
  } catch {
    // base58
    const decoded = bitcoin.address.fromBase58Check(address);
    if (decoded.version === 0 || decoded.version === 111) {
      // P2PKH => OP_DUP OP_HASH160 <hash> OP_EQUALVERIFY OP_CHECKSIG
      return bitcoin.script.compile([
        0x76, // OP_DUP
        0xa9, // OP_HASH160
        decoded.hash,
        0x88, // OP_EQUALVERIFY
        0xac, // OP_CHECKSIG
      ]);
    } else {
      // P2SH => OP_HASH160 <hash> OP_EQUAL
      return bitcoin.script.compile([0xa9, decoded.hash, 0x87]);
    }
  }
}
