import * as bitcoin from 'bitcoinjs-lib';
import BIP32Factory from 'bip32';
import * as secp256k1 from '@bitcoinerlab/secp256k1';
import bs58check from 'bs58check';
import { resetChromeStorage } from '../helpers/chromeMock';
import {
  getFetchCalls,
  installFetchMock,
  jsonResponse,
  mockFetch,
  resetFetchMock,
  restoreFetch,
} from '../helpers/fetchMock';
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

const bip32 = BIP32Factory(secp256k1);

// Swap SLIP-0132 version bytes back to a standard xpub/tpub, like an external tool does on import.
function toStandardXpub(slip0132: string, network: Network): string {
  const standardVersion = network === Network.Mainnet ? 0x0488b21e : 0x043587cf;
  const decoded = bs58check.decode(slip0132);
  const out = new Uint8Array(decoded.length);
  out.set(decoded);
  new DataView(out.buffer).setUint32(0, standardVersion, false);
  return bs58check.encode(out);
}

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

  it('getXpub() returns null (does not throw) when no account is active', async () => {
    await walletManager.createWallet(MNEMONIC, PASSWORD);
    accountManager.activeAccountIndex = -1;
    expect(walletManager.getXpub()).toBeNull();
  });

  // Regression: the export used to encode the master node (depth 0), so addresses derived from
  // the zpub didn't match the wallet's receive addresses. Re-derive the way an external tool would.
  it('exported zpub re-derives the wallet’s own receive addresses (account-level, depth 3)', async () => {
    await walletManager.createWallet(MNEMONIC, PASSWORD);

    const zpub = walletManager.getXpub();
    expect(zpub).toMatch(/^zpub/);
    expect(bs58check.decode(zpub!)[4]).toBe(3); // account node, not the master's 0

    const node = bip32.fromBase58(toStandardXpub(zpub!, Network.Mainnet), bitcoin.networks.bitcoin);
    const addressFromZpub = (index: number) =>
      bitcoin.payments.p2wpkh({
        pubkey: Buffer.from(node.derive(0).derive(index).publicKey),
        network: bitcoin.networks.bitcoin,
      }).address;

    for (let index = 0; index < 3; index++) {
      expect(addressFromZpub(index)).toBe(walletManager.deriveAddress(0, index));
    }

    // Pin the canonical address, not just self-consistency between the two paths.
    expect(addressFromZpub(0)).toBe('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
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

  it('getBalance() can skip fiat pricing', async () => {
    await walletManager.createWallet(MNEMONIC, PASSWORD);
    const utxoKey = getCacheKey(CacheType.Utxo, ChangeType.External);
    await chrome.storage.local.set({
      [utxoKey]: [
        [
          0,
          {
            lastChecked: 0,
            utxos: [{ txid: 'a'.repeat(64), vout: 0, value: 100_000, height: 800_000 }],
          },
        ],
      ],
    });

    const balance = await walletManager.getBalance({ includeFiat: false });

    expect(balance).toEqual({ confirmed: 100_000, unconfirmed: 0, confirmedUsd: 0, unconfirmedUsd: 0 });
    expect(getFetchCalls()).toHaveLength(0);
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

  describe('send-max sweep', () => {
    const TO_ADDR = 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3';

    async function setupMultiUtxoWallet(values: number[]) {
      await walletManager.createWallet(MNEMONIC, PASSWORD);
      const ownAddr = walletManager.deriveAddress(0, 0)!;
      const utxoKey = getCacheKey(CacheType.Utxo, ChangeType.External);
      const addrKey = getCacheKey(CacheType.Address, ChangeType.External);
      await chrome.storage.local.set({
        [addrKey]: [[0, { address: ownAddr, firstSeen: 0, lastChecked: 0, everUsed: true }]],
        [utxoKey]: [
          [
            0,
            {
              lastChecked: 0,
              utxos: values.map((value, i) => ({ txid: `${i}`.repeat(64), vout: 0, value, height: 800_000 })),
            },
          ],
        ],
      });
    }

    it('getMaxSendAmount nets the real multi-input fee off the total balance', async () => {
      await setupMultiUtxoWallet([400_000, 300_000, 300_000]);

      const { amountSats, feeSats } = await walletManager.getMaxSendAmount(TO_ADDR, 5);

      // No leftover: the whole balance is accounted for between the recipient and the fee.
      expect(amountSats + feeSats).toBe(1_000_000);
      expect(amountSats).toBeGreaterThan(0);
    });

    it('sendPayment(isMax) sweeps every UTXO into a single change-less output', async () => {
      await setupMultiUtxoWallet([400_000, 300_000, 300_000]);
      jest.spyOn(scanManager, 'forwardScan').mockResolvedValue();
      jest.spyOn(historyService, 'addOptimisticPending').mockResolvedValue();
      let broadcastHex = '';
      jest.spyOn(electrumService, 'broadcastTx').mockImplementation(async (hex: string) => {
        broadcastHex = hex;
        return bitcoin.Transaction.fromHex(hex).getId();
      });

      const { amountSats } = await walletManager.getMaxSendAmount(TO_ADDR, 5);
      await walletManager.sendPayment(TO_ADDR, amountSats, 5, true);

      const tx = bitcoin.Transaction.fromHex(broadcastHex);
      expect(tx.ins).toHaveLength(3);
      expect(tx.outs).toHaveLength(1);
      expect(tx.outs[0].value).toBe(amountSats);

      jest.restoreAllMocks();
    });

    it('a max amount sized for a single input throws Insufficient funds across 3 real UTXOs, unlike the sweep path', async () => {
      await setupMultiUtxoWallet([400_000, 300_000, 300_000]);
      jest.spyOn(scanManager, 'forwardScan').mockResolvedValue();
      jest.spyOn(historyService, 'addOptimisticPending').mockResolvedValue();
      jest
        .spyOn(electrumService, 'broadcastTx')
        .mockImplementation(async (hex: string) => bitcoin.Transaction.fromHex(hex).getId());

      // What the old UI math produced: balance minus a fee sized for 1 input + 1 change output,
      // regardless of how many UTXOs actually exist. With 3 UTXOs the real fee is bigger than
      // this guess, so this amount isn't actually affordable.
      const staleFeeGuess = Math.ceil((10 + 2 + 68 + 1 + 31 + 31) * 5);
      const staleMaxAmount = 1_000_000 - staleFeeGuess;

      await expect(walletManager.sendPayment(TO_ADDR, staleMaxAmount, 5)).rejects.toThrow('Insufficient funds');

      const { amountSats } = await walletManager.getMaxSendAmount(TO_ADDR, 5);
      expect(amountSats).toBeLessThan(staleMaxAmount);
      await expect(walletManager.sendPayment(TO_ADDR, amountSats, 5, true)).resolves.toEqual(expect.any(String));

      jest.restoreAllMocks();
    });

    it('excludes unconfirmed external UTXOs from the sweep', async () => {
      await walletManager.createWallet(MNEMONIC, PASSWORD);
      const ownAddr = walletManager.deriveAddress(0, 0)!;
      const utxoKey = getCacheKey(CacheType.Utxo, ChangeType.External);
      const addrKey = getCacheKey(CacheType.Address, ChangeType.External);
      await chrome.storage.local.set({
        [addrKey]: [[0, { address: ownAddr, firstSeen: 0, lastChecked: 0, everUsed: true }]],
        [utxoKey]: [
          [
            0,
            {
              lastChecked: 0,
              utxos: [
                { txid: 'a'.repeat(64), vout: 0, value: 500_000, height: 800_000 },
                { txid: 'b'.repeat(64), vout: 0, value: 500_000, height: 0 }, // unconfirmed external
              ],
            },
          ],
        ],
      });

      const { amountSats, feeSats } = await walletManager.getMaxSendAmount(TO_ADDR, 5);
      // Only the confirmed 500_000 UTXO is swept; the unconfirmed deposit is left out.
      expect(amountSats + feeSats).toBe(500_000);
    });

    it('aborts an isMax send when the approved amount no longer matches the current sweep', async () => {
      await setupMultiUtxoWallet([400_000, 300_000, 300_000]);
      jest
        .spyOn(electrumService, 'broadcastTx')
        .mockImplementation(async (hex: string) => bitcoin.Transaction.fromHex(hex).getId());

      const { amountSats } = await walletManager.getMaxSendAmount(TO_ADDR, 5);
      // One sat off the real sweep stands in for UTXOs shifting between preview and confirm.
      await expect(walletManager.sendPayment(TO_ADDR, amountSats - 1, 5, true)).rejects.toThrow(
        'Max send amount changed',
      );

      jest.restoreAllMocks();
    });

    it('getMaxSendAmount rejects a balance that nets a positive but sub-dust output', async () => {
      // 700 sats total, fee 560 at 5 sat/vB leaves 140 — above zero but below the 330 dust floor.
      await setupMultiUtxoWallet([700]);
      await expect(walletManager.getMaxSendAmount(TO_ADDR, 5)).rejects.toThrow('Insufficient funds');
    });
  });
});
