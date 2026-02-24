import type { BIP32Interface } from 'bip32';
import BIP32Factory from 'bip32';
import type { Account, Vault, WalletMeta } from '../types/wallet';
import { ScriptType } from '../types/wallet';
import type { SpendableUtxo } from './utxoSelection';
import { encrypt, decrypt } from '../utils/encryption.js';
import * as bip39 from 'bip39';
import * as secp256k1 from '@bitcoinerlab/secp256k1';
import * as bitcoin from 'bitcoinjs-lib';
import { Network } from '../types/electrum';
import { fingerprintBuffer, purposeFromScriptType, toHdSigner } from '../utils/crypto';
import { accountManager } from '../accountManager';
import { ChangeType } from '../types/cache';

const bip32 = BIP32Factory(secp256k1);
const WALLET_KEY = 'wallet';

/**
 * CreateWalletOptions specify how to restore or create a wallet.
 * - If xpriv is provided, the wallet will be restored from the extended private key.
 * - If a mnemonic is provided (and valid), the wallet is restored from that mnemonic.
 *
 * The network option determines whether the wallet is on "mainnet" or "testnet".
 */
export interface CreateWalletOptions {
  password: string;
  mnemonic?: string;
  xpriv?: string;
  network: Network;
}

/**
 * Manages an HD (Hierarchical Deterministic) Bitcoin wallet, including creation, restoration,
 * encryption, and persistent storage using Chrome's local storage.
 */
export class Wallet {
  private encryptedVault: string | null = null;
  public root: BIP32Interface | null = null;
  private seed: Buffer | null = null;
  private network: bitcoin.networks.Network | undefined;
  private xpub: string | null = null;

  /**
   * Initializes the wallet by loading any existing encrypted vault from storage.
   * @returns {Promise<void>} A promise that resolves when initialization is complete.
   */
  public async init(): Promise<void> {
    await this.load();
  }

  public clear() {
    this.encryptedVault = null;
    this.root = null;
    this.seed = null;
    this.xpub = null;
  }

  /**
   * Restores the wallet from an encrypted vault using the provided password.
   * @param {Network} network - The Bitcoin network to use (Testnet or Mainnet).
   * @param {string} password - The password to decrypt the vault.
   * @returns {Promise<void>} A promise that resolves when restoration is complete.
   * @throws {Error} If no vault exists, the vault is empty, or decryption fails.
   */
  public async restore(network: Network, password: string): Promise<void> {
    if (!this.encryptedVault) {
      throw new Error('Missing vault');
    }

    this.network = network === Network.Testnet ? bitcoin.networks.testnet : bitcoin.networks.bitcoin;
    const vault: Vault | null = await this.decryptVault(password);
    if (!vault) {
      throw new Error('Vault is empty');
    }

    this.deriveRootAndXpub(vault.xpriv, vault.mnemonic);
  }

  /**
   * Creates a new HD wallet or restores from provided options, encrypts the vault, and saves it.
   * @param {CreateWalletOptions} options - Options for creating or restoring the wallet.
   * @returns {Promise<void>} A promise that resolves when creation is complete.
   * @throws {Error} If a wallet already exists, no valid key is provided, or the mnemonic is invalid.
   */
  public async create(options: CreateWalletOptions): Promise<void> {
    if (this.root) {
      throw new Error('Wallet already exist');
    }

    this.network = options.network === Network.Testnet ? bitcoin.networks.testnet : bitcoin.networks.bitcoin;
    const vault: Vault = {
      xpriv: options.xpriv || null,
      mnemonic: options.mnemonic || null,
    };

    if (vault.xpriv === null && vault.mnemonic === null) {
      vault.mnemonic = bip39.generateMnemonic();
    }
    this.deriveRootAndXpub(vault.xpriv, vault.mnemonic);
    await this.encryptVault(vault, options.password);
    await this.save();
  }

  /**
   * Derive an address for based on account, chain & index provide
   * @param account
   * @param chain
   * @param index
   */
  public deriveAddress(account: Account, chain: number, index: number): string | undefined {
    if (!account.xpub) {
      throw new Error('Account missing xpub');
    }

    const network = account.network === Network.Mainnet ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
    const accountNode = bip32.fromBase58(account.xpub, network);
    const childNode = accountNode.derive(chain).derive(index);
    const publicKey = Buffer.from(childNode.publicKey);

    switch (account.scriptType) {
      case ScriptType.P2PKH:
        return bitcoin.payments.p2pkh({ pubkey: publicKey, network } as bitcoin.Payment).address;
      case ScriptType.P2SH_P2WPKH:
        return bitcoin.payments.p2sh({
          redeem: bitcoin.payments.p2wpkh({ pubkey: publicKey, network } as bitcoin.Payment),
          network,
        }).address;
      case ScriptType.P2WPKH:
        return bitcoin.payments.p2wpkh({ pubkey: publicKey, network } as bitcoin.Payment).address;
      case ScriptType.P2TR:
        return bitcoin.payments.p2tr({ internalPubkey: publicKey.slice(1), network } as bitcoin.Payment).address; // Taproot uses x-only pubkey
      default:
        throw new Error('Unsupported script type');
    }
  }

  /**
   * Derive an account based on index provided
   * @param index
   * @param scriptType
   */
  public deriveAccount(index: number, scriptType: ScriptType = ScriptType.P2WPKH): Account {
    if (!this.root) {
      throw new Error('Wallet is not ready');
    }

    const coin = this.network === bitcoin.networks.testnet ? 1 : 0;
    const purpose = purposeFromScriptType(scriptType);
    const accountNode = this.root.deriveHardened(purpose).deriveHardened(coin).deriveHardened(index);
    const accountXpub = accountNode.neutered().toBase58(); // Neutered for safety

    return {
      name: `Account #${index + 1}`,
      index,
      network: this.network === bitcoin.networks.bitcoin ? Network.Mainnet : Network.Testnet,
      xpub: accountXpub,
      scriptType: scriptType,
    };
  }

  /**
   * Retrieves the mnemonic phrase from the decrypted vault.
   * @param {string} password - The password to decrypt the vault.
   */
  public async getMnemonic(password: string): Promise<string | null> {
    const vault: Vault | null = await this.decryptVault(password);
    if (!vault) {
      throw new Error('Vault is empty');
    }
    return vault.mnemonic;
  }

  public getXpub() {
    return this.xpub;
  }

  /**
   * Returns the 4-byte **master fingerprint** of this wallet’s BIP32 root node.
   *
   * The fingerprint is defined by BIP32 as the first 4 bytes of
   * `HASH160(compressed master public key)` and is used by PSBT (BIP174)
   * in `bip32Derivation.masterFingerprint` to identify the signing root.
   *
   **/
  public getMasterFingerprint(): Buffer {
    if (!this.root) throw new Error('Wallet is not ready');
    return fingerprintBuffer(this.root);
  }

  /**
   * Sign a PSBT with wallet’s HD root and return a finalized raw tx hex.
   * Accepts a PSBT instance or hex string.
   *
   * Each input must include bip32Derivation (segwit/legacy) or tapBip32Derivation (taproot)
   * paths that correspond to this wallet's root fingerprint.
   */
  public signPsbt(utxos: SpendableUtxo[], psbt: bitcoin.Psbt): string | undefined {
    try {
      if (!this.root) throw new Error('Wallet is not ready');
      for (let i = 0; i < utxos.length; i++) {
        const account = accountManager.getActiveAccount();
        const accountNode = this.root
          .deriveHardened(purposeFromScriptType(account.scriptType))
          .deriveHardened(account.network === Network.Testnet ? 1 : 0)
          .deriveHardened(account.index);
        const childNode = accountNode.derive(utxos[i].chain === ChangeType.External ? 0 : 1).derive(utxos[i].index);
        psbt.signInput(i, toHdSigner(childNode));
      }

      psbt.finalizeAllInputs();
      return psbt.extractTransaction().toHex();
    } catch (e) {
      console.error(e);
    }
  }

  /**
   * Checks if an encrypted vault is available for restoration.
   * @returns {boolean} True if a vault exists and can be restored, false otherwise.
   */
  public isRestorable(): boolean {
    return !!this.encryptedVault;
  }

  /**
   * Derives the root BIP32 node and xpub from either an xpriv or mnemonic.
   * @param {string | null} [xpriv] - The extended private key (if provided).
   * @param {string | null} [mnemonic] - The mnemonic phrase (if provided).
   * @private
   * @throws {Error} If no valid key is provided or the mnemonic is invalid.
   */
  private deriveRootAndXpub(xpriv?: string | null, mnemonic?: string | null): void {
    if (xpriv) {
      this.root = bip32.fromBase58(xpriv, this.network);
      //Todo: support network switch for xpriv
    } else if (mnemonic) {
      if (!bip39.validateMnemonic(mnemonic)) {
        throw new Error('Invalid mnemonic');
      }
      this.seed = bip39.mnemonicToSeedSync(mnemonic);
      this.root = bip32.fromSeed(this.seed, this.network);
    } else {
      throw new Error('xpriv or mnemonic required');
    }

    this.xpub = this.root.neutered().toBase58();
  }

  /**
   * Decrypts the encrypted vault using the provided password.
   * @param {string} password - The password to decrypt the vault.
   * @returns {Vault | null} The decrypted vault object, or null if no vault exists or decryption fails.
   * @private
   */
  public async decryptVault(password: string): Promise<Vault | null> {
    if (!this.encryptedVault) {
      return null;
    }

    try {
      const decrypted = await decrypt(this.encryptedVault, password);
      return JSON.parse(decrypted);
    } catch {
      throw new Error('Decryption error');
    }
  }

  /**
   * Encrypts the vault using the provided password.
   * @param {Vault} vault - The vault object to encrypt.
   * @param {string} password - The password for encryption.
   * @private
   */
  private async encryptVault(vault: Vault, password: string): Promise<void> {
    this.encryptedVault = await encrypt(JSON.stringify(vault), password);
  }

  /**
   * Loads the wallet's encrypted vault from Chrome's local storage.
   * @returns {Promise<void>} A promise that resolves when loading is complete.
   * @private
   */
  private async load(): Promise<void> {
    const payload = await new Promise<{ [key: string]: WalletMeta | undefined }>(resolve => {
      chrome.storage.local.get(WALLET_KEY, resolve);
    });

    const wallet = payload[WALLET_KEY] ?? null;
    if (wallet) {
      this.encryptedVault = wallet.vault;
    }
  }

  /**
   * Saves the encrypted vault to Chrome's local storage.
   * @returns {Promise<void>} A promise that resolves when saving is complete.
   * @private
   */
  private async save(): Promise<void> {
    await new Promise<void>(resolve => {
      const wallet: WalletMeta = {
        vault: this.encryptedVault,
      };

      chrome.storage.local.set(
        {
          [WALLET_KEY]: wallet,
        },
        () => resolve(),
      );
    });
  }

  public async destroy() {
    chrome.storage.local.remove(WALLET_KEY).then(() => {
      this.clear();
    });
  }
}

export const wallet = new Wallet();
