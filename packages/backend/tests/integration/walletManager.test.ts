import * as bitcoin from 'bitcoinjs-lib';
import { resetChromeStorage } from '../helpers/chromeMock';
import { installFetchMock, jsonResponse, mockFetch, resetFetchMock, restoreFetch } from '../helpers/fetchMock';
import { walletManager } from '../../src/walletManager';
import { wallet } from '../../src/modules/wallet';
import { accountManager } from '../../src/accountManager';
import { preferenceManager, defaultPreferences } from '../../src/preferenceManager';
import { scanManager } from '../../src/scanManager';
import { historyService } from '../../src/modules/txHistoryService';
import { electrumService } from '../../src/modules/electrumService';
import { logger } from '../../src/utils/logger';
import { Network } from '../../src/types/electrum';
import { ScriptType } from '../../src/types/wallet';
import { CacheType, ChangeType } from '../../src/types/cache';
import { getCacheKey } from '../../src/utils/cache';
import { setSessionPassword } from '../../src/utils/sessionStorageHelper';

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'pw';

async function freshState(): Promise<void> {
  resetChromeStorage();
  resetFetchMock();
  mockFetch('blockonomics.co/api/price', () => jsonResponse({ price: 60_000 }));
  wallet.clear();
  (wallet as unknown as { encryptedVault: string | null }).encryptedVault = null;
  accountManager.accounts = [];
  accountManager.activeAccountIndex = -1;
  scanManager.clear();
  historyService.reset();
  Object.defineProperty(preferenceManager, 'preferences', {
    value: { ...defaultPreferences },
    writable: true,
    configurable: true,
  });
  await preferenceManager.update({ ...defaultPreferences });
  await wallet.init();
  await accountManager.init(preferenceManager.get().activeAccountIndex);
}

describe('WalletManager — full lifecycle (integration)', () => {
  beforeAll(() => installFetchMock());
  afterAll(() => restoreFetch());

  beforeEach(async () => {
    await freshState();
  });

  it('createWallet seeds the wallet, derives a default account, and persists everything', async () => {
    await walletManager.createWallet(MNEMONIC, PASSWORD);
    expect(wallet.isRestorable()).toBe(true);
    expect(accountManager.accounts).toHaveLength(1);
    expect(accountManager.getActiveAccount().scriptType).toBe(ScriptType.P2WPKH);
    expect(walletManager.getXpub()).toMatch(/^zpub/);
  });

  it('createWallet generates a fresh mnemonic when none is provided', async () => {
    await walletManager.createWallet(undefined, PASSWORD);
    expect(walletManager.getXpub()).toMatch(/^zpub/);
  });

  it('verifyPassword accepts the right password and rejects the wrong one', async () => {
    await walletManager.createWallet(MNEMONIC, PASSWORD);
    expect(await walletManager.verifyPassword(PASSWORD)).toBe(true);
    expect(await walletManager.verifyPassword('wrong')).toBe(false);
  });

  it('lock() drops in-memory keys and the session password', async () => {
    await walletManager.createWallet(MNEMONIC, PASSWORD);
    await setSessionPassword(PASSWORD);
    await walletManager.lock();
    expect(wallet.root).toBeNull();
  });

  it('restoreIfPossible() returns true when a vault exists and a session password is provided', async () => {
    await walletManager.createWallet(MNEMONIC, PASSWORD);
    wallet.clear();
    expect(await walletManager.restoreIfPossible(PASSWORD)).toBe(true);
    expect(wallet.root).not.toBeNull();
  });

  it('restoreIfPossible() returns false without a session password', async () => {
    await walletManager.createWallet(MNEMONIC, PASSWORD);
    wallet.clear();
    expect(await walletManager.restoreIfPossible(null)).toBe(false);
  });

  it('restoreIfPossible() returns false when no vault exists', async () => {
    expect(await walletManager.restoreIfPossible(PASSWORD)).toBe(false);
  });

  it('getMnemonic() returns the original mnemonic', async () => {
    await walletManager.createWallet(MNEMONIC, PASSWORD);
    expect(await walletManager.getMnemonic(PASSWORD)).toBe(MNEMONIC);
  });

  it('getXpub() returns null when the wallet is locked', async () => {
    await walletManager.createWallet(MNEMONIC, PASSWORD);
    wallet.clear();
    expect(walletManager.getXpub()).toBeNull();
  });

  it('switchEvmNetwork() updates the activeEvmNetwork preference only', async () => {
    await walletManager.createWallet(MNEMONIC, PASSWORD);
    expect(preferenceManager.get().activeEvmNetwork).toBe(Network.Mainnet);
    await walletManager.switchEvmNetwork(Network.Testnet);
    expect(preferenceManager.get().activeEvmNetwork).toBe(Network.Testnet);
    expect(preferenceManager.get().activeNetwork).toBe(Network.Mainnet);
  });

  it('deriveAddress() yields the canonical BIP-84 address for the test mnemonic at index 0', async () => {
    await walletManager.createWallet(MNEMONIC, PASSWORD);
    expect(walletManager.deriveAddress(0, 0)).toBe('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
  });

  it('deriveAddress() throws when no active account exists', async () => {
    await wallet.init();
    expect(() => walletManager.deriveAddress(0, 0)).toThrow(/No active account available/);
  });

  it('getActiveAccountListIndex returns the active index from preferences', async () => {
    await walletManager.createWallet(MNEMONIC, PASSWORD);
    expect(walletManager.getActiveAccountListIndex()).toBe(0);
  });

  it('getHighestAccountIndex returns -1 when no accounts on the active network', async () => {
    expect(walletManager.getHighestAccountIndex()).toBe(-1);
  });

  it('getHighestAccountIndex tracks the max HD index across active-network accounts', async () => {
    await walletManager.createWallet(MNEMONIC, PASSWORD);
    expect(walletManager.getHighestAccountIndex()).toBe(0);
    await accountManager.add({
      name: 'A2',
      index: 7,
      network: Network.Mainnet,
      xpub: 'x',
      scriptType: ScriptType.P2WPKH,
    });
    expect(walletManager.getHighestAccountIndex()).toBe(7);
  });

  it('getBalance() reads from UTXO cache and applies BTC price', async () => {
    await walletManager.createWallet(MNEMONIC, PASSWORD);
    const utxoKey = getCacheKey(CacheType.Utxo, ChangeType.External);
    await chrome.storage.local.set({
      [utxoKey]: [
        [
          0,
          {
            lastChecked: 0,
            utxos: [
              { txid: 'a'.repeat(64), vout: 0, value: 100_000, height: 800_000 },
              { txid: 'b'.repeat(64), vout: 0, value: 50_000, height: 0 },
            ],
          },
        ],
      ],
    });
    const balance = await walletManager.getBalance();
    expect(balance.confirmed).toBe(100_000);
    expect(balance.unconfirmed).toBe(50_000);
    expect(balance.confirmedUsd).toBeCloseTo((100_000 / 1e8) * 60_000, 6);
  });

  it('getBalance() trusts pending change outputs as confirmed (internal chain)', async () => {
    await walletManager.createWallet(MNEMONIC, PASSWORD);
    const changeKey = getCacheKey(CacheType.Utxo, ChangeType.Internal);
    await chrome.storage.local.set({
      [changeKey]: [
        [
          0,
          {
            lastChecked: 0,
            utxos: [{ txid: 'c'.repeat(64), vout: 0, value: 30_000, height: 0 }],
          },
        ],
      ],
    });
    const balance = await walletManager.getBalance();
    expect(balance.confirmed).toBe(30_000);
    expect(balance.unconfirmed).toBe(0);
  });

  it('getUtxos() flattens both chains into SpendableUtxo[] with confirmations', async () => {
    await walletManager.createWallet(MNEMONIC, PASSWORD);
    const rxAddrKey = getCacheKey(CacheType.Address, ChangeType.External);
    const rxUtxoKey = getCacheKey(CacheType.Utxo, ChangeType.External);
    await chrome.storage.local.set({
      [rxAddrKey]: [[0, { address: 'bc1qaddr', firstSeen: 0, lastChecked: 0, everUsed: true }]],
      [rxUtxoKey]: [
        [0, { lastChecked: 0, utxos: [{ txid: 'a'.repeat(64), vout: 0, value: 100_000, height: 800_000 }] }],
      ],
    });
    jest.spyOn(electrumService, 'getTipHeader').mockResolvedValue({ height: 800_010, merkle_root: '00'.repeat(32) });
    const utxos = await walletManager.getUtxos();
    expect(utxos).toHaveLength(1);
    expect(utxos[0].confirmations).toBe(11);
    expect(utxos[0].chain).toBe(ChangeType.External);
    expect(utxos[0].scriptType).toBe(ScriptType.P2WPKH);
    jest.restoreAllMocks();
  });

  it('createAccount() derives a new account and bumps activeAccountIndex', async () => {
    await walletManager.createWallet(MNEMONIC, PASSWORD);
    expect(accountManager.accounts).toHaveLength(1);
    await walletManager.createAccount();
    expect(accountManager.accounts).toHaveLength(2);
    expect(preferenceManager.get().activeAccountIndex).toBe(1);
  });

  it('logout() wipes the wallet, accounts, prefs, and caches', async () => {
    await walletManager.createWallet(MNEMONIC, PASSWORD);
    await walletManager.logout();
    const stored = await chrome.storage.local.get(['wallet', 'accounts']);
    expect(stored.wallet).toBeUndefined();
    expect(stored.accounts).toBeUndefined();
    expect(accountManager.accounts).toEqual([]);
    expect(wallet.root).toBeNull();
  });

  it('getAddress() returns a derived next-receive address', async () => {
    await walletManager.createWallet(MNEMONIC, PASSWORD);
    const addr = walletManager.getAddress(ChangeType.External);
    expect(addr).toMatch(/^bc1q/);
    const change = walletManager.getAddress(ChangeType.Internal);
    expect(change).toMatch(/^bc1q/);
    expect(addr).not.toEqual(change);
  });

  describe('sendPayment() — local-txid trust boundary', () => {
    const TO_ADDR = 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3';

    async function setupSpendableUtxo() {
      await walletManager.createWallet(MNEMONIC, PASSWORD);
      const ownAddr = walletManager.deriveAddress(0, 0)!;
      const utxoKey = getCacheKey(CacheType.Utxo, ChangeType.External);
      const addrKey = getCacheKey(CacheType.Address, ChangeType.External);
      await chrome.storage.local.set({
        [addrKey]: [[0, { address: ownAddr, firstSeen: 0, lastChecked: 0, everUsed: true }]],
        [utxoKey]: [
          [0, { lastChecked: 0, utxos: [{ txid: 'a'.repeat(64), vout: 0, value: 1_000_000, height: 800_000 }] }],
        ],
      });
    }

    it('uses the locally-computed txid (not the server reply) for addOptimisticPending and the return value', async () => {
      await setupSpendableUtxo();

      const ATTACKER_TXID = 'd'.repeat(64);
      let computedLocalTxid: string | undefined;
      jest.spyOn(electrumService, 'broadcastTx').mockImplementation(async (hex: string) => {
        computedLocalTxid = bitcoin.Transaction.fromHex(hex).getId();
        return ATTACKER_TXID;
      });
      const addPendingSpy = jest.spyOn(historyService, 'addOptimisticPending').mockResolvedValue();
      jest.spyOn(scanManager, 'forwardScan').mockResolvedValue();
      const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});

      const returned = await walletManager.sendPayment(TO_ADDR, 50_000, 1);

      expect(computedLocalTxid).toMatch(/^[0-9a-f]{64}$/);
      expect(returned).toBe(computedLocalTxid);
      expect(returned).not.toBe(ATTACKER_TXID);
      expect(addPendingSpy).toHaveBeenCalledWith(expect.objectContaining({ txid: computedLocalTxid }));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/divergent txid/));

      jest.restoreAllMocks();
    });

    it('does not warn when the server-returned txid matches the local one', async () => {
      await setupSpendableUtxo();

      jest
        .spyOn(electrumService, 'broadcastTx')
        .mockImplementation(async (hex: string) => bitcoin.Transaction.fromHex(hex).getId());
      jest.spyOn(historyService, 'addOptimisticPending').mockResolvedValue();
      jest.spyOn(scanManager, 'forwardScan').mockResolvedValue();
      const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});

      await walletManager.sendPayment(TO_ADDR, 50_000, 1);

      const divergentWarnings = warnSpy.mock.calls.filter(
        args => typeof args[0] === 'string' && args[0].includes('divergent txid'),
      );
      expect(divergentWarnings).toHaveLength(0);

      jest.restoreAllMocks();
    });
  });
});
