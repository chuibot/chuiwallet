jest.mock('../../src/modules/assetPriceService', () => ({
  assetPriceService: {
    getUsdPrices: jest.fn(async () => ({ bitcoin: 60_000 })),
  },
}));

jest.mock('../../src/preferenceManager', () => ({
  preferenceManager: {
    get: () => ({ fiatCurrency: 'USD' }),
  },
}));

import { BitcoinAdapter } from '../../src/adapters/BitcoinAdapter';
import { ChainType } from '../../src/adapters/IChainAdapter';
import { ChangeType, type TxEntry } from '../../src/types/cache';
import { Network } from '../../src/types/electrum';
import type { Balance } from '../../src/types/wallet';
import { assetPriceService } from '../../src/modules/assetPriceService';

function makeStubs() {
  const wallet = {
    deriveAddress: jest.fn().mockReturnValue('bc1qderived'),
    getAddress: jest.fn().mockReturnValue('bc1qreceive'),
    getBalance: jest.fn(
      async (): Promise<Balance> => ({
        confirmed: 200_000_000,
        unconfirmed: 50_000_000,
        confirmedUsd: 12_000,
        unconfirmedUsd: 3_000,
      }),
    ),
    getFeeEstimates: jest.fn(async () => [
      { speed: 'slow', sats: 2, btcAmount: 0.0001, usdAmount: 6 },
      { speed: 'medium', sats: 5, btcAmount: 0.0003, usdAmount: 18 },
      { speed: 'fast', sats: 10, btcAmount: 0.0006, usdAmount: 36 },
    ]),
    sendPayment: jest.fn(async () => 'txhashAAA'),
  };
  const electrum = { init: jest.fn(), connect: jest.fn(), disconnect: jest.fn() };
  const scan = {};
  const history = {
    get: jest.fn(
      async (): Promise<TxEntry[]> => [
        {
          type: 'RECEIVE',
          status: 'CONFIRMED',
          amountBtc: 0.5,
          amountUsd: 30_000,
          feeBtc: 0.0001,
          feeUsd: 6,
          timestamp: 1_700_000_000_000,
          confirmations: 6,
          transactionHash: 'h0',
          sender: 'bc1other',
          receiver: 'bc1qreceive',
        },
      ],
    ),
  };
  return {
    wallet: wallet as never,
    electrum: electrum as never,
    scan: scan as never,
    history: history as never,
  };
}

describe('BitcoinAdapter — metadata + lifecycle', () => {
  it('exposes BTC metadata', () => {
    const { wallet, electrum, scan, history } = makeStubs();
    const a = new BitcoinAdapter(wallet, electrum, scan, history);
    expect(a.chainType).toBe(ChainType.Bitcoin);
    expect(a.symbol).toBe('BTC');
    expect(a.decimals).toBe(8);
    expect(a.displayName).toBe('Bitcoin');
  });

  it('init delegates to electrumService.init with the network', async () => {
    const { wallet, electrum, scan, history } = makeStubs();
    const a = new BitcoinAdapter(wallet, electrum, scan, history);
    await a.init(Network.Testnet);
    expect(electrum.init).toHaveBeenCalledWith(Network.Testnet);
  });

  it('connect / disconnect delegate to electrumService', async () => {
    const { wallet, electrum, scan, history } = makeStubs();
    const a = new BitcoinAdapter(wallet, electrum, scan, history);
    await a.connect();
    expect(electrum.connect).toHaveBeenCalled();
    await a.disconnect();
    expect(electrum.disconnect).toHaveBeenCalled();
  });
});

describe('BitcoinAdapter — addresses', () => {
  it('deriveAddress returns the wallet-derived address', () => {
    const { wallet, electrum, scan, history } = makeStubs();
    const a = new BitcoinAdapter(wallet, electrum, scan, history);
    expect(a.deriveAddress(0, 5)).toBe('bc1qderived');
    expect(wallet.deriveAddress).toHaveBeenCalledWith(0, 5);
  });

  it('deriveAddress throws when wallet returns undefined', () => {
    const { wallet, electrum, scan, history } = makeStubs();
    wallet.deriveAddress = jest.fn().mockReturnValue(undefined);
    const a = new BitcoinAdapter(wallet, electrum, scan, history);
    expect(() => a.deriveAddress(0, 0)).toThrow(/Failed to derive BTC address/);
  });

  it('getReceivingAddress uses ChangeType.External', () => {
    const { wallet, electrum, scan, history } = makeStubs();
    const a = new BitcoinAdapter(wallet, electrum, scan, history);
    expect(a.getReceivingAddress()).toBe('bc1qreceive');
    expect(wallet.getAddress).toHaveBeenCalledWith(ChangeType.External);
  });
});

describe('BitcoinAdapter — getBalance', () => {
  it('translates Balance into ChainBalance with rate from price service', async () => {
    const { wallet, electrum, scan, history } = makeStubs();
    const a = new BitcoinAdapter(wallet, electrum, scan, history);
    const out = await a.getBalance();
    expect(out.confirmed).toBe(200_000_000);
    expect(out.unconfirmed).toBe(50_000_000);
    expect(out.confirmedFiat).toBe(12_000);
    expect(out.nativeFiatRate).toBe(60_000);
  });

  it('still returns nativeFiatRate from the price service when balance is zero', async () => {
    const { wallet, electrum, scan, history } = makeStubs();
    wallet.getBalance = jest.fn(async () => ({ confirmed: 0, unconfirmed: 0, confirmedUsd: 0, unconfirmedUsd: 0 }));
    const a = new BitcoinAdapter(wallet, electrum, scan, history);
    const out = await a.getBalance();
    expect(out.nativeFiatRate).toBe(60_000);
  });

  it('omits nativeFiatRate when the price service returns no price', async () => {
    (assetPriceService.getUsdPrices as jest.Mock).mockResolvedValueOnce({});
    const { wallet, electrum, scan, history } = makeStubs();
    const a = new BitcoinAdapter(wallet, electrum, scan, history);
    const out = await a.getBalance();
    expect(out.nativeFiatRate).toBeUndefined();
  });
});

describe('BitcoinAdapter — getTransactionHistory', () => {
  it('maps amounts from BTC to sats and statuses to lower-case', async () => {
    const { wallet, electrum, scan, history } = makeStubs();
    const a = new BitcoinAdapter(wallet, electrum, scan, history);
    const out = await a.getTransactionHistory();
    expect(out).toHaveLength(1);
    expect(out[0].amount).toBe(50_000_000);
    expect(out[0].fee).toBe(10_000);
    expect(out[0].status).toBe('confirmed');
    expect(out[0].chain).toBe(ChainType.Bitcoin);
  });

  it('marks PENDING entries as pending', async () => {
    const { wallet, electrum, scan, history } = makeStubs();
    history.get = jest.fn(async () => [
      {
        type: 'SEND',
        status: 'PENDING',
        amountBtc: 0.1,
        feeBtc: 0,
        timestamp: 0,
        confirmations: 0,
        transactionHash: 'h1',
        sender: '',
        receiver: '',
      } as TxEntry,
    ]);
    const a = new BitcoinAdapter(wallet, electrum, scan, history);
    expect((await a.getTransactionHistory())[0].status).toBe('pending');
  });
});

describe('BitcoinAdapter — sendPayment + estimateFee', () => {
  it('parses BTC string into sats and applies feeRate (default 1)', async () => {
    const { wallet, electrum, scan, history } = makeStubs();
    const a = new BitcoinAdapter(wallet, electrum, scan, history);
    await a.sendPayment('bc1qrecv', '0.5');
    expect(wallet.sendPayment).toHaveBeenCalledWith('bc1qrecv', 50_000_000, 1);
  });

  it('parses BTC string with feeRate option', async () => {
    const { wallet, electrum, scan, history } = makeStubs();
    const a = new BitcoinAdapter(wallet, electrum, scan, history);
    await a.sendPayment('bc1qrecv', '1', { feeRate: 7 });
    expect(wallet.sendPayment).toHaveBeenCalledWith('bc1qrecv', 100_000_000, 7);
  });

  it('rejects amounts with too many decimals', async () => {
    const { wallet, electrum, scan, history } = makeStubs();
    const a = new BitcoinAdapter(wallet, electrum, scan, history);
    await expect(a.sendPayment('bc1qrecv', '0.123456789')).rejects.toThrow(/up to 8 decimal places/);
  });

  it('rejects malformed amount strings', async () => {
    const { wallet, electrum, scan, history } = makeStubs();
    const a = new BitcoinAdapter(wallet, electrum, scan, history);
    await expect(a.sendPayment('bc1qrecv', '1.2.3')).rejects.toThrow(/Invalid BTC amount/);
  });

  it('rejects amount of zero', async () => {
    const { wallet, electrum, scan, history } = makeStubs();
    const a = new BitcoinAdapter(wallet, electrum, scan, history);
    await expect(a.sendPayment('bc1qrecv', '0')).rejects.toThrow(/greater than 0/);
  });

  it('normalises ".5" to 50_000_000 sats', async () => {
    const { wallet, electrum, scan, history } = makeStubs();
    const a = new BitcoinAdapter(wallet, electrum, scan, history);
    await a.sendPayment('bc1qrecv', '.5');
    expect(wallet.sendPayment).toHaveBeenCalledWith('bc1qrecv', 50_000_000, 1);
  });

  it('estimateFee maps three speeds to ChainFeeEstimate[]', async () => {
    const { wallet, electrum, scan, history } = makeStubs();
    const a = new BitcoinAdapter(wallet, electrum, scan, history);
    const estimates = await a.estimateFee('bc1qrecv');
    expect(estimates).toHaveLength(3);
    expect(estimates.map(e => e.speed)).toEqual(['slow', 'medium', 'fast']);
    expect(estimates[0].rateUnit).toBe('sat/vB');
    expect(estimates[2].rateValue).toBe(10);
    expect(estimates[2].sendOptions?.feeRate).toBe(10);
  });

  it('estimateFee returns [] when wallet returns undefined', async () => {
    const { wallet, electrum, scan, history } = makeStubs();
    wallet.getFeeEstimates = jest.fn(async () => undefined);
    const a = new BitcoinAdapter(wallet, electrum, scan, history);
    expect(await a.estimateFee('bc1qrecv')).toEqual([]);
  });
});
