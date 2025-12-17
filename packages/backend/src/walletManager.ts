import type { CreateWalletOptions } from './modules/wallet';
import type { SpendableUtxo, utxoSelectionResult } from './modules/utxoSelection';
import type { AddressEntry, UtxoEntry } from './types/cache';
import type { Network } from './types/electrum';
import { CacheType, ChangeType } from './types/cache';
import browser from 'webextension-polyfill';
import * as secp256k1 from '@bitcoinerlab/secp256k1';
import * as bitcoin from 'bitcoinjs-lib';
import { wallet } from './modules/wallet';
import { accountManager } from './accountManager';
import { defaultPreferences, preferenceManager } from './preferenceManager';
import { scanManager } from './scanManager';
import { electrumService } from './modules/electrumService';
import { feeService } from './modules/feeService';
import { logger } from './utils/logger';
import { selectUtxo } from './modules/utxoSelection';
import { getCacheKey, selectByChain } from './utils/cache';
import { buildSpendPsbt } from './utils/psbt';
import { getBitcoinPrice } from './modules/blockonomics';
import { scriptTypeFromAddress } from './utils/crypto';
import { deleteSessionPassword, getSessionPassword } from './utils/sessionStorageHelper';
import { historyService } from './modules/txHistoryService';
import { Balance } from './types/wallet';

bitcoin.initEccLib(secp256k1);

/**
 * Manages the wallet lifecycle, including initialization, restoration, creation,
 * account management, and preferences synchronization.
 */
export class WalletManager {
  /**
   * Initializes the wallet manager by loading preferences and initializing the wallet.
   * @returns {Promise<void>} A promise that resolves when initialization is complete.
   */
  async init(): Promise<void> {
    await wallet.init();
  }

  async lock() {
    wallet.clear();
    await deleteSessionPassword();
  }

  async logout() {
    await scanManager.clearCache();
    await historyService.clearCache();
    await accountManager.destroy();
    await wallet.destroy();
    await preferenceManager.update(defaultPreferences);
    await deleteSessionPassword();
  }

  async switchNetwork(network: Network) {
    const sessionPassword = await getSessionPassword();
    if (sessionPassword) {
      electrumService.disconnect('switchNetwork');
      scanManager.clear();
      await preferenceManager.update({ activeNetwork: network });
      await wallet.restore(preferenceManager.get().activeNetwork, sessionPassword);
      await this.ensureDefaultAccount();
      await electrumService.init(preferenceManager.get().activeNetwork);
      await electrumService.connect();
      await accountManager.init(preferenceManager.get().activeAccountIndex);
      await scanManager.init();
      return true;
    }

    return false;
  }

  verifyPassword(password: string): boolean {
    try {
      const success = wallet.decryptVault(password);
      return !!success;
    } catch {
      return false;
    }
  }

  /**
   * Get current receiving/change address
   * @param changeType
   */
  public getAddress(changeType: ChangeType = ChangeType.External) {
    const nextIndex = selectByChain(scanManager.nextReceiveIndex, scanManager.nextChangeIndex, changeType);
    return this.deriveAddress(changeType === ChangeType.External ? 0 : 1, nextIndex);
  }

  /**
   * Aggregate confirmed/unconfirmed balance for the active account by summing UTXOs
   * from both external(0/receive) and internal(1/change) chains.
   */
  public async getBalance(): Promise<Balance> {
    const activeAccount = accountManager.getActiveAccount();
    if (!activeAccount) {
      return { confirmed: 0, unconfirmed: 0, confirmedUsd: 0, unconfirmedUsd: 0 };
    }

    const receiveKey = getCacheKey(CacheType.Utxo, ChangeType.External);
    const changeKey = getCacheKey(CacheType.Utxo, ChangeType.Internal);
    const payload = await browser.storage.local.get([receiveKey, changeKey]);

    const toPairs = (v: unknown): [number, UtxoEntry][] => (Array.isArray(v) ? (v as [number, UtxoEntry][]) : []);
    const receivePairs = toPairs(payload[receiveKey]);
    const changePairs = toPairs(payload[changeKey]);

    let confirmed = 0;
    let unconfirmed = 0;
    const addFrom = (pairs: [number, UtxoEntry][]) => {
      for (const [, entry] of pairs) {
        if (!entry?.utxos) continue;
        for (const u of entry.utxos) {
          if (u.height && u.height > 0) confirmed += u.value;
          else unconfirmed += u.value;
        }
      }
    };

    addFrom(receivePairs);
    addFrom(changePairs);

    let confirmedUsd = 0;
    let unconfirmedUsd = 0;
    try {
      const rate = await getBitcoinPrice();
      confirmedUsd = (confirmed / 1e8) * rate;
      unconfirmedUsd = (unconfirmed / 1e8) * rate;
    } catch {
      console.error('Error getting Bitcoin price');
    }

    return { confirmed, unconfirmed, confirmedUsd, unconfirmedUsd };
  }

  public async getFeeEstimates(toAddress: string) {
    try {
      // We don't know the amount to spend yet, assuming 1 input with empty inputs for feeService.getFeeEstimates
      return await feeService.getFeeEstimates([], toAddress, accountManager.getActiveAccount().scriptType);
    } catch (error) {
      console.log(error);
    }
  }

  public async getUtxos(): Promise<SpendableUtxo[]> {
    // Storage keys written by ScanManager
    const rxUtxoKey = getCacheKey(CacheType.Utxo, ChangeType.External);
    const chUtxoKey = getCacheKey(CacheType.Utxo, ChangeType.Internal);
    const rxAddrKey = getCacheKey(CacheType.Address, ChangeType.External);
    const chAddrKey = getCacheKey(CacheType.Address, ChangeType.Internal);

    const [store, tipHeight] = await Promise.all([
      browser.storage.local.get([rxUtxoKey, chUtxoKey, rxAddrKey, chAddrKey]),
      electrumService.getTipHeight().catch(() => 0),
    ]);

    const toMap = <T>(v: unknown) => new Map<number, T>(Array.isArray(v) ? (v as [number, T][]) : []);
    const rxUtxo = toMap<UtxoEntry>(store[rxUtxoKey]);
    const chUtxo = toMap<UtxoEntry>(store[chUtxoKey]);
    const rxAddr = toMap<AddressEntry>(store[rxAddrKey]);
    const chAddr = toMap<AddressEntry>(store[chAddrKey]);

    const scriptType = accountManager.getActiveAccount().scriptType;

    const flatten = (m: Map<number, UtxoEntry>, a: Map<number, AddressEntry>, chain: ChangeType) =>
      Array.from(m.entries()).flatMap(([index, entry]) =>
        (entry?.utxos ?? []).map(
          u =>
            ({
              txid: u.txid,
              vout: u.vout,
              value: u.value,
              height: u.height,
              confirmations: tipHeight > 0 && u.height > 0 ? Math.max(0, tipHeight - u.height + 1) : 0,
              address: a.get(index)?.address ?? '',
              index,
              chain,
              scriptType,
            }) as SpendableUtxo,
        ),
      );

    return [...flatten(rxUtxo, rxAddr, ChangeType.External), ...flatten(chUtxo, chAddr, ChangeType.Internal)];
  }

  /**
   * Builds, signs, and broadcasts a PAYMENT (spend to one recipient).
   */
  public async sendPayment(to: string, amountSats: number, feerateSatPerVb: number): Promise<string> {
    logger.log(`Sending ${amountSats} to ${to} at the rate of ${feerateSatPerVb}`);
    const utxos = await this.getUtxos();
    const account = accountManager.getActiveAccount();
    const changeScript = account.scriptType;
    const toScript = scriptTypeFromAddress(to);
    const feeSizer = feeService.createFeeSizer(feerateSatPerVb, changeScript, toScript);
    const selectedUtxo: utxoSelectionResult = selectUtxo(utxos, amountSats, feeSizer, feeService.DUST[changeScript]);
    const outputs: Array<{ address: string; value: number }> = [{ address: to, value: amountSats }];
    if (selectedUtxo.change > 0) {
      const changeAddr = this.getAddress(ChangeType.Internal);
      if (!changeAddr) throw new Error('Unable to derive change address');
      outputs.push({ address: changeAddr, value: selectedUtxo.change });
    }

    const masterFp = wallet.getMasterFingerprint();
    const psbt = await buildSpendPsbt({
      inputs: selectedUtxo.inputs,
      outputs,
      account: account,
      masterFingerprint: masterFp,
      getPrevTxHex: (txid: string) => electrumService.getRawTransaction(txid), // Todo: only used for legacy P2PKH, consider depracation
    });
    const txHex = wallet.signPsbt(selectedUtxo.inputs, psbt);
    logger.log('Send TX Hex', txHex);
    return await electrumService.broadcastTx(txHex!);
  }

  /**
   * Attempts to restore the wallet if possible using the provided session password.
   * @param {string} sessionPassword - The password from session storage.
   * @returns {Promise<boolean>} True if restoration was successful, false otherwise.
   */
  async restoreIfPossible(sessionPassword: string | null): Promise<boolean> {
    if (!wallet.isRestorable() || !sessionPassword) {
      return false;
    }

    await wallet.restore(preferenceManager.get().activeNetwork, sessionPassword);
    await this.ensureDefaultAccount();
    return true;
  }

  /**
   * Get the mnemonic of the current wallet
   * @param password
   */
  public getMnemonic(password: string) {
    return wallet.getMnemonic(password);
  }

  /**
   * Get the xpub of the current wallet
   */
  public getXpub() {
    return wallet.getXpub();
  }

  /**
   * Check if current wallet is restorable
   */
  public isRestorable(): boolean {
    return wallet.isRestorable();
  }

  /**
   * Derive new receiving address for the active account
   * @param chain
   * @param index
   */
  public deriveAddress(chain: number, index: number): string | undefined {
    const activeIndex = this.getActiveAccountListIndex();
    const activeAccount = accountManager.accounts[activeIndex];
    if (!activeAccount) {
      throw new Error('No active account available');
    }
    // Todo: (Optional) Check if wallet is restored/unlocked

    return wallet.deriveAddress(activeAccount, chain, index);
  }

  /**
   * Gets the index of the active account from preferences.
   * @returns {number} The active account index.
   */
  public getActiveAccountListIndex(): number {
    return preferenceManager.get().activeAccountIndex;
  }

  /**
   * Gets the highest account index
   */
  public getHighestAccountIndex(): number {
    const networkAccounts = accountManager.accounts.filter(a => a.network === preferenceManager.get().activeNetwork);
    if (networkAccounts.length === 0) {
      return -1;
    }
    return Math.max(...networkAccounts.map(a => a.index));
  }

  /**
   * Creates a new wallet with the provided mnemonic and password, and ensures a default account.
   * @param {string} mnemonic - The mnemonic phrase for the new wallet.
   * @param {string} password - The password to encrypt the vault.
   * @returns {Promise<void>} A promise that resolves when creation is complete.
   */
  public async createWallet(mnemonic: string, password: string): Promise<void> {
    await wallet.create({
      network: preferenceManager.get().activeNetwork,
      mnemonic,
      password,
    } as CreateWalletOptions);
    await this.ensureDefaultAccount(true); // Force creation for new wallets
  }

  /**
   * Derive and set the next account as active
   */
  public async deriveNextAccount() {
    const account = wallet.deriveAccount(this.getHighestAccountIndex() + 1);
    const activeAccountIndex = await accountManager.add(account);
    preferenceManager.get().activeAccountIndex = activeAccountIndex;
    await preferenceManager.update({ activeAccountIndex: activeAccountIndex });
  }

  /**
   * Ensures a default account (index 0) exists for the active network, deriving and adding it if necessary.
   * @param {boolean} [forceCreate=false] - If true, creates the account even if one exists.
   * @private
   */
  private async ensureDefaultAccount(forceCreate: boolean = false): Promise<void> {
    const activeNetwork = preferenceManager.get().activeNetwork;
    let defaultAccountIndex = accountManager.accounts.findIndex(a => a.network === activeNetwork && a.index === 0);

    if (forceCreate || defaultAccountIndex === -1) {
      const defaultAccount = wallet.deriveAccount(0);
      defaultAccountIndex = await accountManager.add(defaultAccount);
    }

    preferenceManager.get().activeAccountIndex = defaultAccountIndex;
    await preferenceManager.update({ activeAccountIndex: defaultAccountIndex });
  }
}

export const walletManager = new WalletManager();
