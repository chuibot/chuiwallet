import { Buffer } from 'buffer';
import * as bitcoin from 'bitcoinjs-lib';
import * as bip39 from 'bip39';
import * as secp256k1 from '@bitcoinerlab/secp256k1';
import { resetChromeStorage } from '../helpers/chromeMock';
import { Wallet } from '../../src/modules/wallet';
import { ScriptType } from '../../src/types/wallet';
import { Network } from '../../src/types/electrum';
import { ChangeType } from '../../src/types/cache';
import { accountManager } from '../../src/accountManager';
import { buildSpendPsbt } from '../../src/utils/psbt';
import { fingerprintBuffer } from '../../src/utils/crypto';

bitcoin.initEccLib(secp256k1);

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'correct horse battery staple';

describe('Wallet — creation & restoration', () => {
  beforeEach(() => resetChromeStorage());

  it('create() with no seed generates a fresh BIP39 mnemonic', async () => {
    const w = new Wallet();
    await w.init();
    await w.create({ password: PASSWORD, network: Network.Mainnet });
    expect(w.root).not.toBeNull();
    expect(w.getXpub()).toMatch(/^xpub/);
  });

  it('create() with a provided mnemonic restores the canonical xpub', async () => {
    const w = new Wallet();
    await w.init();
    await w.create({ password: PASSWORD, network: Network.Mainnet, mnemonic: MNEMONIC });
    expect(w.getXpub()).toMatch(/^xpub/);
  });

  it('throws "Invalid mnemonic" on a malformed phrase', async () => {
    const w = new Wallet();
    await w.init();
    await expect(
      w.create({ password: PASSWORD, network: Network.Mainnet, mnemonic: 'totally not a valid phrase' }),
    ).rejects.toThrow('Invalid mnemonic');
  });

  it('throws "Wallet already exist" on second create()', async () => {
    const w = new Wallet();
    await w.init();
    await w.create({ password: PASSWORD, network: Network.Mainnet, mnemonic: MNEMONIC });
    await expect(w.create({ password: PASSWORD, network: Network.Mainnet, mnemonic: MNEMONIC })).rejects.toThrow(
      'Wallet already exist',
    );
  });

  it('persists encrypted vault to chrome.storage.local under "wallet"', async () => {
    const w = new Wallet();
    await w.init();
    await w.create({ password: PASSWORD, network: Network.Mainnet, mnemonic: MNEMONIC });
    const stored = await chrome.storage.local.get('wallet');
    expect((stored.wallet as { vault: string }).vault).toBeTruthy();
    expect(typeof (stored.wallet as { vault: string }).vault).toBe('string');
    expect((stored.wallet as { vault: string }).vault).not.toContain(MNEMONIC);
  });

  it('restore() from a fresh instance loads and decrypts the persisted vault', async () => {
    const first = new Wallet();
    await first.init();
    await first.create({ password: PASSWORD, network: Network.Mainnet, mnemonic: MNEMONIC });

    const second = new Wallet();
    await second.init();
    expect(second.isRestorable()).toBe(true);
    await second.restore(Network.Mainnet, PASSWORD);
    expect(second.getXpub()).toBe(first.getXpub());
  });

  it('restore() with the wrong password throws "Decryption error"', async () => {
    const w = new Wallet();
    await w.init();
    await w.create({ password: PASSWORD, network: Network.Mainnet, mnemonic: MNEMONIC });
    const fresh = new Wallet();
    await fresh.init();
    await expect(fresh.restore(Network.Mainnet, 'wrong-pw')).rejects.toThrow('Decryption error');
  });

  it('restore() throws "Missing vault" when no wallet has been created', async () => {
    const w = new Wallet();
    await w.init();
    await expect(w.restore(Network.Mainnet, 'pw')).rejects.toThrow('Missing vault');
  });

  it('isRestorable returns false on a fresh storage', async () => {
    const w = new Wallet();
    await w.init();
    expect(w.isRestorable()).toBe(false);
  });

  it('clear() drops in-memory keys but keeps the encrypted vault', async () => {
    const w = new Wallet();
    await w.init();
    await w.create({ password: PASSWORD, network: Network.Mainnet, mnemonic: MNEMONIC });
    w.clear();
    expect(w.root).toBeNull();
    expect(w.getXpub()).toBeNull();
    expect(w.isRestorable()).toBe(true);
  });

  it('destroy() wipes persisted vault and in-memory keys (fresh instance is not restorable)', async () => {
    const w = new Wallet();
    await w.init();
    await w.create({ password: PASSWORD, network: Network.Mainnet, mnemonic: MNEMONIC });
    await w.destroy();
    const stored = await chrome.storage.local.get('wallet');
    expect(stored.wallet).toBeUndefined();
    expect(w.root).toBeNull();
    const fresh = new Wallet();
    await fresh.init();
    expect(fresh.isRestorable()).toBe(false);
  });

  it('getMnemonic() returns the stored mnemonic on correct password', async () => {
    const w = new Wallet();
    await w.init();
    await w.create({ password: PASSWORD, network: Network.Mainnet, mnemonic: MNEMONIC });
    expect(await w.getMnemonic(PASSWORD)).toBe(MNEMONIC);
  });

  it('getMnemonic() rejects on wrong password', async () => {
    const w = new Wallet();
    await w.init();
    await w.create({ password: PASSWORD, network: Network.Mainnet, mnemonic: MNEMONIC });
    await expect(w.getMnemonic('nope')).rejects.toBeDefined();
  });
});

describe('Wallet — derivation', () => {
  beforeEach(() => resetChromeStorage());

  it("deriveAccount on mainnet uses coin=0 and matches BIP84 path m/84'/0'/0'", async () => {
    const w = new Wallet();
    await w.init();
    await w.create({ password: PASSWORD, network: Network.Mainnet, mnemonic: MNEMONIC });
    const account = w.deriveAccount(0, ScriptType.P2WPKH);
    expect(account.network).toBe(Network.Mainnet);
    expect(account.scriptType).toBe(ScriptType.P2WPKH);
    expect(account.xpub).toMatch(/^xpub/);
  });

  it('deriveAccount on testnet uses coin=1 and emits tpub', async () => {
    const w = new Wallet();
    await w.init();
    await w.create({ password: PASSWORD, network: Network.Testnet, mnemonic: MNEMONIC });
    const account = w.deriveAccount(0, ScriptType.P2WPKH);
    expect(account.network).toBe(Network.Testnet);
    expect(account.xpub).toMatch(/^tpub/);
  });

  it('deriveAccount with different indices yields different xpubs', async () => {
    const w = new Wallet();
    await w.init();
    await w.create({ password: PASSWORD, network: Network.Mainnet, mnemonic: MNEMONIC });
    expect(w.deriveAccount(0).xpub).not.toEqual(w.deriveAccount(1).xpub);
  });

  it('deriveAccount throws when the wallet is not unlocked', () => {
    const w = new Wallet();
    expect(() => w.deriveAccount(0)).toThrow('Wallet is not ready');
  });

  it('deriveAddress at index 0 for the test mnemonic produces the canonical BIP84 address', async () => {
    const w = new Wallet();
    await w.init();
    await w.create({ password: PASSWORD, network: Network.Mainnet, mnemonic: MNEMONIC });
    const account = w.deriveAccount(0, ScriptType.P2WPKH);
    const addr = w.deriveAddress(account, 0, 0);
    expect(addr).toBe('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
  });

  it('deriveAddress for P2TR matches the canonical BIP86 vector', async () => {
    const w = new Wallet();
    await w.init();
    await w.create({ password: PASSWORD, network: Network.Mainnet, mnemonic: MNEMONIC });
    const account = w.deriveAccount(0, ScriptType.P2TR);
    const addr = w.deriveAddress(account, 0, 0)!;
    expect(addr).toBe('bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr');
  });

  it('deriveAddress for P2SH_P2WPKH matches the canonical BIP49 vector', async () => {
    const w = new Wallet();
    await w.init();
    await w.create({ password: PASSWORD, network: Network.Mainnet, mnemonic: MNEMONIC });
    const account = w.deriveAccount(0, ScriptType.P2SH_P2WPKH);
    const addr = w.deriveAddress(account, 0, 0)!;
    expect(addr).toBe('37VucYSaXLCAsxYyAPfbSi9eh4iEcbShgf');
  });

  it('deriveAddress for P2PKH matches the canonical BIP44 vector', async () => {
    const w = new Wallet();
    await w.init();
    await w.create({ password: PASSWORD, network: Network.Mainnet, mnemonic: MNEMONIC });
    const account = w.deriveAccount(0, ScriptType.P2PKH);
    const addr = w.deriveAddress(account, 0, 0)!;
    expect(addr).toBe('1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA');
  });

  it('deriveAccount xpubs match canonical BIP44/49/84/86 vectors for all script types', async () => {
    const w = new Wallet();
    await w.init();
    await w.create({ password: PASSWORD, network: Network.Mainnet, mnemonic: MNEMONIC });
    expect(w.deriveAccount(0, ScriptType.P2PKH).xpub).toBe(
      'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj',
    );
    expect(w.deriveAccount(0, ScriptType.P2SH_P2WPKH).xpub).toBe(
      'xpub6C6nQwHaWbSrzs5tZ1q7m5R9cPK9eYpNMFesiXsYrgc1P8bvLLAet9JfHjYXKjToD8cBRswJXXbbFpXgwsswVPAZzKMa1jUp2kVkGVUaJa7',
    );
    expect(w.deriveAccount(0, ScriptType.P2WPKH).xpub).toBe(
      'xpub6CatWdiZiodmUeTDp8LT5or8nmbKNcuyvz7WyksVFkKB4RHwCD3XyuvPEbvqAQY3rAPshWcMLoP2fMFMKHPJ4ZeZXYVUhLv1VMrjPC7PW6V',
    );
    expect(w.deriveAccount(0, ScriptType.P2TR).xpub).toBe(
      'xpub6BgBgsespWvERF3LHQu6CnqdvfEvtMcQjYrcRzx53QJjSxarj2afYWcLteoGVky7D3UKDP9QyrLprQ3VCECoY49yfdDEHGCtMMj92pReUsQ',
    );
  });

  it('deriveAddress throws when account.xpub is missing', async () => {
    const w = new Wallet();
    await w.init();
    await w.create({ password: PASSWORD, network: Network.Mainnet, mnemonic: MNEMONIC });
    expect(() =>
      w.deriveAddress({ name: '', index: 0, network: Network.Mainnet, xpub: '', scriptType: ScriptType.P2WPKH }, 0, 0),
    ).toThrow('Account missing xpub');
  });

  it('getMasterFingerprint returns a 4-byte buffer matching fingerprintBuffer', async () => {
    const w = new Wallet();
    await w.init();
    await w.create({ password: PASSWORD, network: Network.Mainnet, mnemonic: MNEMONIC });
    const fp = w.getMasterFingerprint();
    expect(fp.length).toBe(4);
    expect(fp.equals(fingerprintBuffer(w.root!))).toBe(true);
  });

  it('getMasterFingerprint throws when the wallet is locked', () => {
    const w = new Wallet();
    expect(() => w.getMasterFingerprint()).toThrow('Wallet is not ready');
  });
});

describe('Wallet — signPsbt', () => {
  beforeEach(async () => {
    resetChromeStorage();
    accountManager.accounts = [];
    accountManager.activeAccountIndex = -1;
  });

  it('signs and finalizes a self-pay P2WPKH PSBT and returns valid raw tx hex', async () => {
    const w = new Wallet();
    await w.init();
    await w.create({ password: PASSWORD, network: Network.Mainnet, mnemonic: MNEMONIC });
    const account = w.deriveAccount(0, ScriptType.P2WPKH);
    await accountManager.add(account);
    const fromAddr = w.deriveAddress(account, 0, 0)!;
    const fp = w.getMasterFingerprint();
    const utxo = {
      txid: 'a'.repeat(64),
      vout: 0,
      value: 100_000,
      height: 800_000,
      confirmations: 6,
      address: fromAddr,
      index: 0,
      chain: ChangeType.External,
      scriptType: ScriptType.P2WPKH,
    };
    const psbt = await buildSpendPsbt({
      inputs: [utxo],
      outputs: [{ address: fromAddr, value: 90_000 }],
      account,
      masterFingerprint: fp,
    });
    const txHex = w.signPsbt([utxo], psbt);
    expect(typeof txHex).toBe('string');
    expect(txHex!.length).toBeGreaterThan(50);
    const tx = bitcoin.Transaction.fromHex(txHex!);
    expect(tx.outs).toHaveLength(1);
    expect(tx.outs[0].value).toBe(90_000);
  });

  it('signPsbt returns undefined when wallet is not ready', () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const w = new Wallet();
    expect(w.signPsbt([], new bitcoin.Psbt())).toBeUndefined();
    errSpy.mockRestore();
  });

  async function setupP2wpkhFixture() {
    const w = new Wallet();
    await w.init();
    await w.create({ password: PASSWORD, network: Network.Mainnet, mnemonic: MNEMONIC });
    const account = w.deriveAccount(0, ScriptType.P2WPKH);
    await accountManager.add(account);
    const fromAddr = w.deriveAddress(account, 0, 0)!;
    const fp = w.getMasterFingerprint();
    const utxo = {
      txid: 'a'.repeat(64),
      vout: 0,
      value: 100_000,
      height: 800_000,
      confirmations: 6,
      address: fromAddr,
      index: 0,
      chain: ChangeType.External,
      scriptType: ScriptType.P2WPKH,
    };
    const psbt = await buildSpendPsbt({
      inputs: [utxo],
      outputs: [{ address: fromAddr, value: 90_000 }],
      account,
      masterFingerprint: fp,
    });
    return { w, utxo, psbt };
  }

  it('rejects a PSBT whose bip32Derivation declares a different master fingerprint', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { w, utxo, psbt } = await setupP2wpkhFixture();
    psbt.data.inputs[0].bip32Derivation![0].masterFingerprint = Buffer.from('deadbeef', 'hex');
    expect(w.signPsbt([utxo], psbt)).toBeUndefined();
    expect(errSpy).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('missing bip32 derivation for this wallet') }),
    );
    errSpy.mockRestore();
  });

  it('rejects a PSBT whose bip32Derivation path differs from the expected leaf index', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { w, utxo, psbt } = await setupP2wpkhFixture();
    psbt.data.inputs[0].bip32Derivation![0].path = "m/84'/0'/0'/0/5";
    expect(w.signPsbt([utxo], psbt)).toBeUndefined();
    expect(errSpy).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('path mismatch') }));
    errSpy.mockRestore();
  });

  it('rejects a PSBT path that points at a different account index', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { w, utxo, psbt } = await setupP2wpkhFixture();
    psbt.data.inputs[0].bip32Derivation![0].path = "m/84'/0'/1'/0/0";
    expect(w.signPsbt([utxo], psbt)).toBeUndefined();
    expect(errSpy).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('path mismatch') }));
    errSpy.mockRestore();
  });

  it('rejects a PSBT input that has no bip32Derivation and no tapBip32Derivation', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { w, utxo, psbt } = await setupP2wpkhFixture();
    delete psbt.data.inputs[0].bip32Derivation;
    expect(w.signPsbt([utxo], psbt)).toBeUndefined();
    expect(errSpy).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('missing bip32 derivation') }),
    );
    errSpy.mockRestore();
  });

  it('rejects a taproot PSBT whose tapBip32Derivation path is tampered', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const w = new Wallet();
    await w.init();
    await w.create({ password: PASSWORD, network: Network.Mainnet, mnemonic: MNEMONIC });
    const account = w.deriveAccount(0, ScriptType.P2TR);
    await accountManager.add(account);
    const fromAddr = w.deriveAddress(account, 0, 0)!;
    const fp = w.getMasterFingerprint();
    const utxo = {
      txid: 'b'.repeat(64),
      vout: 0,
      value: 100_000,
      height: 800_000,
      confirmations: 6,
      address: fromAddr,
      index: 0,
      chain: ChangeType.External,
      scriptType: ScriptType.P2TR,
    };
    const psbt = await buildSpendPsbt({
      inputs: [utxo],
      outputs: [{ address: fromAddr, value: 90_000 }],
      account,
      masterFingerprint: fp,
    });
    psbt.data.inputs[0].tapBip32Derivation![0].path = "m/86'/0'/0'/0/9";
    expect(w.signPsbt([utxo], psbt)).toBeUndefined();
    expect(errSpy).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('path mismatch') }));
    errSpy.mockRestore();
  });
});

describe('Wallet — secure memory', () => {
  beforeEach(() => resetChromeStorage());

  it('zeroes the BIP39 seed buffer after deriving the root', async () => {
    const realMnemonicToSeedSync = bip39.mnemonicToSeedSync;
    let capturedSeed: Buffer | null = null;
    jest.spyOn(bip39, 'mnemonicToSeedSync').mockImplementation((m: string) => {
      const seed = realMnemonicToSeedSync(m);
      capturedSeed = seed;
      return seed;
    });
    try {
      const w = new Wallet();
      await w.init();
      await w.create({ password: PASSWORD, network: Network.Mainnet, mnemonic: MNEMONIC });
      expect(capturedSeed).not.toBeNull();
      expect(capturedSeed!.every(b => b === 0)).toBe(true);
    } finally {
      jest.restoreAllMocks();
    }
  });
});
