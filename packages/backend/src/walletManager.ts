import type { CreateWalletOptions } from './modules/wallet';
import type { SpendableUtxo, utxoSelectionResult } from './modules/utxoSelection';
import type { AddressEntry, UtxoEntry } from './types/cache';
import type { Network } from './types/electrum';
import type { Balance } from './types/wallet';
import { CacheType, ChangeType } from './types/cache';
import browser from 'webextension-polyfill';
import * as secp256k1 from '@bitcoinerlab/secp256k1';
import * as bitcoin from 'bitcoinjs-lib';
import { wallet } from './modules/wallet';
import { accountManager } from './accountManager';
import { defaultPreferences, preferenceManager } from './preferenceManager';
import { scanManager } from './scanManager';
import { electrumService } from './modules/electrumService';
import { historyService } from './modules/txHistoryService';
import { feeService } from './modules/feeService';
import { logger } from './utils/logger';
import { selectUtxo } from './modules/utxoSelection';
import { getCacheKey, selectByChain } from './utils/cache';
import { buildSpendPsbt } from './utils/psbt';
import { getBitcoinPrice } from './modules/blockonomics';
import { scriptTypeFromAddress } from './utils/crypto';
import { verifyMerkleProof } from './utils/merkle';
import { deleteSessionPassword, getSessionPassword } from './utils/sessionStorageHelper';
import { convertToSlip0132 } from './utils/xpubConverter';
import bs58check from 'bs58check';

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
    if (!sessionPassword) return false;

    const previousPrefs = preferenceManager.get();
    const previousNetwork = previousPrefs.activeNetwork;
    const previousAccountIndex = previousPrefs.activeAccountIndex;
    electrumService.disconnect('switchNetwork');

    try {
      await preferenceManager.update({ activeNetwork: network });
      await wallet.restore(network, sessionPassword);
      await this.ensureDefaultAccount();
      await electrumService.init(network);
      await electrumService.connect();
      await accountManager.init(preferenceManager.get().activeAccountIndex);
      scanManager.clear();
      await scanManager.init();
      historyService.reset();
      return true;
    } catch (err) {
      // A failed electrumService.connect() emits a reasonless 'disconnected'
      // which the background listener treats as a real drop and starts
      // reconnecting against the failed target. Re-tag the teardown with
      // 'switchNetwork' so the background cancels that in-flight retry
      // before we rebuild state for the previous network.
      electrumService.disconnect('switchNetwork');
      // Without a full rollback, the 'switchNetwork' disconnect reason suppresses
      // auto-reconnect and the wallet sits permanently on "Disconnected". We also
      // restore the previous account index — ensureDefaultAccount() may have moved
      // it before init/connect failed, which would otherwise leave the previous
      // network paired with the new network's account index.
      logger.error('switchNetwork failed, rolling back to previous network', err);
      await preferenceManager.update({
        activeNetwork: previousNetwork,
        activeAccountIndex: previousAccountIndex,
      });
      await wallet.restore(previousNetwork, sessionPassword).catch(() => undefined);
      await accountManager.init(previousAccountIndex).catch(() => undefined);
      scanManager.clear();
      await scanManager.init().catch(() => undefined);
      // Only reconnect after init for the previous network actually succeeded —
      // otherwise this.rpcClient is still the failed target-network client and
      // connect() would reach for the wrong server while prefs sit on previous.
      let restoredElectrum = false;
      try {
        await electrumService.init(previousNetwork);
        restoredElectrum = true;
      } catch (restoreErr) {
        logger.error('rollback electrum init failed', restoreErr);
      }
      if (restoredElectrum) {
        void electrumService.connect().catch(error => logger.error('rollback reconnect failed', error));
      }
      throw err;
    }
  }

  /**
   * Switch only the EVM (Ethereum) network without affecting Bitcoin.
   * Updates the activeEvmNetwork preference only.
   */
  async switchEvmNetwork(network: Network) {
    await preferenceManager.update({ activeEvmNetwork: network });
    return true;
  }

  public async switchAccount(accountListIndex: number) {
    const account = accountManager.accounts[accountListIndex];
    if (!account) {
      throw new Error('Account not found');
    }

    const sessionPassword = await getSessionPassword();
    if (!sessionPassword) {
      throw new Error('Password is required');
    }

    const prefs = preferenceManager.get();
    const networkChanged = prefs.activeNetwork !== account.network;

    if (networkChanged) {
      const previousNetwork = prefs.activeNetwork;
      const previousAccountIndex = prefs.activeAccountIndex;
      try {
        electrumService.disconnect('switchNetwork');
        await preferenceManager.update({ activeNetwork: account.network, activeAccountIndex: accountListIndex });
        await wallet.restore(account.network, sessionPassword);
        await electrumService.init(account.network);
        await electrumService.connect();
        await accountManager.init(accountListIndex);
        scanManager.clear();
        await scanManager.init();
        historyService.reset();
        return preferenceManager.get();
      } catch (err) {
        // Re-tag the teardown so the background cancels any auto-reconnect
        // that the failed connect()'s reasonless 'disconnected' triggered.
        electrumService.disconnect('switchNetwork');
        logger.error('switchAccount network change failed, rolling back', err);
        await preferenceManager.update({ activeNetwork: previousNetwork, activeAccountIndex: previousAccountIndex });
        await wallet.restore(previousNetwork, sessionPassword).catch(() => undefined);
        await accountManager.init(previousAccountIndex).catch(() => undefined);
        scanManager.clear();
        await scanManager.init().catch(() => undefined);
        // Same guard as switchNetwork: only reconnect after rollback init
        // succeeds, otherwise we'd reconnect the failed target-network client.
        let restoredElectrum = false;
        try {
          await electrumService.init(previousNetwork);
          restoredElectrum = true;
        } catch (restoreErr) {
          logger.error('rollback electrum init failed', restoreErr);
        }
        if (restoredElectrum) {
          void electrumService.connect().catch(error => logger.error('rollback reconnect failed', error));
        }
        throw err;
      }
    }

    await preferenceManager.update({ activeAccountIndex: accountListIndex });
    await accountManager.init(accountListIndex);
    scanManager.clear();
    await scanManager.init();
    historyService.reset();
    return preferenceManager.get();
  }

  async verifyPassword(password: string): Promise<boolean> {
    try {
      const success = await wallet.decryptVault(password);
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

    const processUtxos = (pairs: [number, UtxoEntry][], isInternalChain: boolean) => {
      for (const [, entry] of pairs) {
        if (!entry?.utxos) continue;
        for (const u of entry.utxos) {
          // 1. Strictly Confirmed: Has been mined into a block (height > 0)
          const isConfirmed = u.height && u.height > 0;

          // 2. Trusted Pending: It is unconfirmed, BUT it is on our Internal (Change) chain.
          // We trust our own change outputs immediately so the user's balance doesn't flicker/drop.
          const isTrustedChange = isInternalChain && !isConfirmed;

          if (isConfirmed || isTrustedChange) {
            confirmed += u.value;
          } else {
            unconfirmed += u.value;
          }
        }
      }
    };

    // External Chain (Receive): Only count as confirmed if actually mined
    processUtxos(receivePairs, false);

    // Internal Chain (Change): Count as confirmed if mined OR if it's our own pending change
    processUtxos(changePairs, true);

    let confirmedUsd = 0;
    let unconfirmedUsd = 0;
    try {
      const fiatCurrency = preferenceManager.get().fiatCurrency || 'USD';
      const rate = await getBitcoinPrice(fiatCurrency === 'BTC' ? 'USD' : fiatCurrency);
      confirmedUsd = (confirmed / 1e8) * rate;
      unconfirmedUsd = (unconfirmed / 1e8) * rate;
    } catch {
      console.error('Error getting Bitcoin price');
    }

    return { confirmed, unconfirmed, confirmedUsd, unconfirmedUsd };
  }

  public async getFeeEstimates(toAddress: string) {
    try {
      const account = accountManager.getActiveAccount();
      return await feeService.getFeeEstimates([], toAddress, account.network, account.scriptType);
    } catch (error) {
      console.log(error);
      return undefined;
    }
  }

  public async getUtxos(): Promise<SpendableUtxo[]> {
    // Storage keys written by ScanManager
    const rxUtxoKey = getCacheKey(CacheType.Utxo, ChangeType.External);
    const chUtxoKey = getCacheKey(CacheType.Utxo, ChangeType.Internal);
    const rxAddrKey = getCacheKey(CacheType.Address, ChangeType.External);
    const chAddrKey = getCacheKey(CacheType.Address, ChangeType.Internal);

    const [store, tipHeader] = await Promise.all([
      browser.storage.local.get([rxUtxoKey, chUtxoKey, rxAddrKey, chAddrKey]),
      electrumService.getTipHeader().catch(() => null),
    ]);
    const tipHeight = tipHeader?.height ?? 0;

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

    const allUtxos = [...flatten(rxUtxo, rxAddr, ChangeType.External), ...flatten(chUtxo, chAddr, ChangeType.Internal)];

    if (!tipHeader) return allUtxos;

    const toVerify = allUtxos.filter(u => u.height === tipHeader.height);
    if (toVerify.length === 0) return allUtxos;

    const verified = new Set<string>();
    await Promise.allSettled(
      toVerify.map(async u => {
        try {
          const proof = await electrumService.getMerkleProof(u.txid, u.height);
          if (verifyMerkleProof(u.txid, proof.pos, proof.merkle, tipHeader.merkle_root)) {
            verified.add(u.txid);
          } else {
            logger.warn(`Merkle proof failed for ${u.txid} at height ${u.height} — excluding UTXO`);
          }
        } catch {
          verified.add(u.txid); // server error → include (graceful degradation)
        }
      }),
    );

    return allUtxos.filter(u => u.height !== tipHeader.height || verified.has(u.txid));
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
    const localTxid = bitcoin.Transaction.fromHex(txHex).getId();
    const serverTxid = await electrumService.broadcastTx(txHex);
    if (serverTxid !== localTxid) {
      logger.warn(`Electrum returned a divergent txid: server=${serverTxid} local=${localTxid}`);
    }

    try {
      await historyService.addOptimisticPending({
        txid: localTxid,
        toAddress: to,
        fromAddress: selectedUtxo.inputs[0].address,
        amountSats,
        feeSats: selectedUtxo.fee,
      });
    } catch (err) {
      logger.warn('Failed to record optimistic pending tx', err);
    }

    // Awaited (not fire-and-forget) so the MV3 service worker stays alive long
    // enough for the canonical entry to replace the optimistic one.
    await Promise.allSettled([
      scanManager.forwardScan().catch(err => logger.warn('Post-send forward scan failed', err)),
      scanManager.forwardScan(ChangeType.Internal).catch(err => logger.warn('Post-send change-chain scan failed', err)),
    ]);

    return localTxid;
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
  public async getMnemonic(password: string) {
    return await wallet.getMnemonic(password);
  }

  /** Account-level zpub/ypub for the active account. Null if locked or no active account. */
  public getXpub() {
    // master xpub is null when the wallet is locked, so bail before exporting anything
    if (!wallet.getXpub()) return null;

    let activeAccount;
    try {
      activeAccount = accountManager.getActiveAccount();
    } catch {
      return null; // no active account (e.g. after logout)
    }

    // has to be the account node (depth 3), anything higher won't match the receive addresses
    if (bs58check.decode(activeAccount.xpub)[4] !== 3) {
      throw new Error('Refusing to export non-account-level extended public key');
    }

    return convertToSlip0132(activeAccount.xpub, activeAccount.scriptType, activeAccount.network);
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
  public async createWallet(mnemonic: string | undefined, password: string): Promise<void> {
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
    await accountManager.init(preferenceManager.get().activeAccountIndex);
    const activeNetwork = preferenceManager.get().activeNetwork;
    const usedIndices = new Set(accountManager.accounts.filter(a => a.network === activeNetwork).map(a => a.index));
    let nextIndex = 0;
    while (usedIndices.has(nextIndex)) {
      nextIndex++;
    }
    const account = wallet.deriveAccount(nextIndex);
    const activeAccountIndex = await accountManager.add(account);
    await preferenceManager.update({ activeAccountIndex: activeAccountIndex });
  }

  public async createAccount() {
    await this.deriveNextAccount();
    await accountManager.init(preferenceManager.get().activeAccountIndex);
    scanManager.clear();
    await scanManager.init();
    historyService.reset();
    return preferenceManager.get();
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

    await preferenceManager.update({ activeAccountIndex: defaultAccountIndex });
  }
}

export const walletManager = new WalletManager();
