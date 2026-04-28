import { resetChromeStorage } from '../helpers/chromeMock';
import { installFetchMock, jsonResponse, mockFetch, resetFetchMock, restoreFetch } from '../helpers/fetchMock';
import { FeeService } from '../../src/modules/feeService';
import { ScriptType } from '../../src/types/wallet';
import { Network } from '../../src/types/electrum';
import { ChangeType } from '../../src/types/cache';
import { preferenceManager } from '../../src/preferenceManager';
import type { SpendableUtxo } from '../../src/modules/utxoSelection';

const mkUtxo = (scriptType: ScriptType): SpendableUtxo => ({
  txid: 'a'.repeat(64),
  vout: 0,
  value: 100_000,
  height: 800_000,
  confirmations: 6,
  address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
  index: 0,
  chain: ChangeType.External,
  scriptType,
});

describe('FeeService.createFeeSizer', () => {
  it('grows fee linearly with input count', () => {
    const svc = new FeeService();
    const sizer = svc.createFeeSizer(2, ScriptType.P2WPKH, ScriptType.P2WPKH);
    expect(sizer(2, true)).toBeGreaterThan(sizer(1, true));
    expect(sizer(3, true)).toBeGreaterThan(sizer(2, true));
  });

  it('charges less when no change output is requested', () => {
    const svc = new FeeService();
    const sizer = svc.createFeeSizer(2, ScriptType.P2WPKH, ScriptType.P2WPKH);
    expect(sizer(1, false)).toBeLessThan(sizer(1, true));
  });

  it('rounds the fee up (Math.ceil)', () => {
    const svc = new FeeService();
    const sizer = svc.createFeeSizer(1, ScriptType.P2WPKH, ScriptType.P2WPKH);
    const f = sizer(1, true);
    expect(Number.isInteger(f)).toBe(true);
  });
});

describe('FeeService.IN_VBYTES / OUT_VBYTES / DUST', () => {
  const svc = new FeeService();
  it('matches expected vbyte sizes per script type', () => {
    expect(svc.IN_VBYTES[ScriptType.P2WPKH]).toBe(68);
    expect(svc.IN_VBYTES[ScriptType.P2TR]).toBe(57);
    expect(svc.IN_VBYTES[ScriptType.P2SH_P2WPKH]).toBe(91);
    expect(svc.IN_VBYTES[ScriptType.P2PKH]).toBe(148);
    expect(svc.OUT_VBYTES[ScriptType.P2WPKH]).toBe(31);
    expect(svc.OUT_VBYTES[ScriptType.P2TR]).toBe(43);
  });

  it('legacy P2PKH dust is higher than segwit', () => {
    expect(svc.DUST[ScriptType.P2PKH]).toBeGreaterThan(svc.DUST[ScriptType.P2WPKH]);
  });
});

describe('FeeService.getFeeEstimates', () => {
  beforeAll(() => installFetchMock());
  afterAll(() => restoreFetch());

  beforeEach(async () => {
    resetChromeStorage();
    resetFetchMock();
    Object.defineProperty(preferenceManager, 'preferences', {
      value: { fiatCurrency: 'USD' },
      writable: true,
      configurable: true,
    });
    mockFetch('blockonomics.co/api/price', () => jsonResponse({ price: 60_000 }));
  });

  it('aggregates the three speed tiers', async () => {
    mockFetch('mempool.space/api/v1/fees/recommended', () =>
      jsonResponse({ fastestFee: 30, halfHourFee: 15, hourFee: 5 }),
    );
    const svc = new FeeService();
    const tiers = await svc.getFeeEstimates(
      [mkUtxo(ScriptType.P2WPKH)],
      'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
      Network.Mainnet,
      ScriptType.P2WPKH,
    );
    expect(tiers).toHaveLength(3);
    expect(tiers.map(t => t.speed)).toEqual(['slow', 'medium', 'fast']);
    expect(tiers[0].sats).toBe(5);
    expect(tiers[1].sats).toBe(15);
    expect(tiers[2].sats).toBe(30);
    expect(tiers[2].usdAmount).toBeGreaterThan(0);
  });

  it('falls back to hardcoded {10/5/2} sat/vB when all providers fail', async () => {
    mockFetch('mempool.space', () => new Response('boom', { status: 500 }));
    mockFetch('blockstream.info', () => new Response('boom', { status: 500 }));
    mockFetch('blockchain.info', () => new Response('boom', { status: 500 }));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const svc = new FeeService();
    const tiers = await svc.getFeeEstimates(
      [mkUtxo(ScriptType.P2WPKH)],
      'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
      Network.Mainnet,
      ScriptType.P2WPKH,
    );
    expect(tiers.map(t => t.sats)).toEqual([2, 5, 10]);
    errSpy.mockRestore();
  });

  it('uses testnet endpoints for testnet network', async () => {
    let usedTestnet = false;
    mockFetch('mempool.space/testnet4/api/v1/fees/recommended', () => {
      usedTestnet = true;
      return jsonResponse({ fastestFee: 4, halfHourFee: 2, hourFee: 1 });
    });
    mockFetch('blockstream.info/testnet/api/fee-estimates', () => jsonResponse({}));
    const svc = new FeeService();
    await svc.getFeeEstimates(
      [mkUtxo(ScriptType.P2WPKH)],
      'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',
      Network.Testnet,
      ScriptType.P2WPKH,
    );
    expect(usedTestnet).toBe(true);
  });
});
