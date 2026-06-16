import type { FeeOptionSetting } from '../types/electrum';
import type { SpendableUtxo } from './utxoSelection';
import { ScriptType } from '../types/wallet';
import { scriptTypeFromAddress } from '../utils/crypto';
import { getBitcoinPrice } from './blockonomics';
import { Network } from '../types/electrum';
import { preferenceManager } from '../preferenceManager';
import { coerceFiniteNumber, isFiniteNumber, isRecord } from '../utils/validation';

export type FeeSizer = (inputCount: number, includeChange: boolean) => number;

type FeeRates = { fastestFee: number; halfHourFee: number; hourFee: number };

const FALLBACK_FEES: FeeRates = {
  fastestFee: 10,
  halfHourFee: 5,
  hourFee: 2,
};

/** Reject a provider response whose rates are not finite positive numbers. */
function assertFeeRates(rates: { fastestFee?: number; halfHourFee?: number; hourFee?: number }): FeeRates {
  const { fastestFee, halfHourFee, hourFee } = rates;
  if (!isFiniteNumber(fastestFee) || !isFiniteNumber(halfHourFee) || !isFiniteNumber(hourFee)) {
    throw new Error('Malformed fee response');
  }
  if (fastestFee <= 0 || halfHourFee <= 0 || hourFee <= 0) {
    throw new Error('Non-positive fee response');
  }
  return { fastestFee, halfHourFee, hourFee };
}

async function fetchWithTimeout(url: string, options: any = {}, timeout = 5000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return response;
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

export class FeeService {
  public IN_VBYTES: Readonly<Record<ScriptType, number>> = {
    [ScriptType.P2WPKH]: 68,
    [ScriptType.P2TR]: 57,
    [ScriptType.P2SH_P2WPKH]: 91,
    [ScriptType.P2PKH]: 148,
  };

  public OUT_VBYTES: Readonly<Record<ScriptType, number>> = {
    [ScriptType.P2WPKH]: 31,
    [ScriptType.P2TR]: 43,
    [ScriptType.P2SH_P2WPKH]: 32,
    [ScriptType.P2PKH]: 34,
  };

  public DUST: Readonly<Record<ScriptType, number>> = {
    [ScriptType.P2WPKH]: 330,
    [ScriptType.P2TR]: 330,
    [ScriptType.P2SH_P2WPKH]: 330,
    [ScriptType.P2PKH]: 546,
  };

  private async fetchMempool(network: Network): Promise<FeeRates> {
    const baseUrl = network === Network.Mainnet ? 'https://mempool.space/api' : 'https://mempool.space/testnet4/api';
    const res = await fetchWithTimeout(`${baseUrl}/v1/fees/recommended`);
    const data = await res.json();
    if (!isRecord(data)) throw new Error('Malformed mempool.space response');
    return assertFeeRates({
      fastestFee: coerceFiniteNumber(data.fastestFee),
      halfHourFee: coerceFiniteNumber(data.halfHourFee),
      hourFee: coerceFiniteNumber(data.hourFee),
    });
  }

  private async fetchBlockstream(network: Network): Promise<FeeRates> {
    const baseUrl =
      network === Network.Mainnet ? 'https://blockstream.info/api' : 'https://blockstream.info/testnet/api';
    const res = await fetchWithTimeout(`${baseUrl}/fee-estimates`);
    const estimates = await res.json();
    if (!isRecord(estimates)) throw new Error('Malformed blockstream.info response');
    const pick = (keys: string[]): number | undefined => {
      for (const key of keys) {
        const n = coerceFiniteNumber(estimates[key]);
        if (n !== undefined && n > 0) return Math.ceil(n);
      }
      return undefined;
    };
    return assertFeeRates({
      fastestFee: pick(['1', '2']),
      halfHourFee: pick(['3', '6']),
      hourFee: pick(['12', '24']),
    });
  }

  private async fetchBlockchainInfo(): Promise<FeeRates> {
    const res = await fetchWithTimeout('https://api.blockchain.info/mempool/fees');
    const data = await res.json();
    if (!isRecord(data)) throw new Error('Malformed blockchain.info response');
    const priority = coerceFiniteNumber(data.priority);
    const regular = coerceFiniteNumber(data.regular);
    if (priority === undefined || regular === undefined) {
      throw new Error('Malformed blockchain.info response');
    }
    return assertFeeRates({
      fastestFee: priority,
      halfHourFee: regular,
      hourFee: Math.max(1, regular - 1),
    });
  }

  private async getReliableFeeRates(network: Network): Promise<FeeRates> {
    const providers = [this.fetchMempool(network), this.fetchBlockstream(network)];
    if (network === Network.Mainnet) {
      providers.push(this.fetchBlockchainInfo());
    }

    const results = await Promise.allSettled(providers);
    const fulfilled = results
      .filter((r): r is PromiseFulfilledResult<FeeRates> => r.status === 'fulfilled')
      .map(r => r.value);

    if (fulfilled.length === 0) {
      console.error('All fee providers failed or timed out, using fallback');
      return FALLBACK_FEES;
    }

    const clamp = (v: number) => Math.min(1000, Math.max(1, Math.round(v)));
    const med = (key: keyof FeeRates): number => {
      const vals = fulfilled.map(f => f[key]).sort((a, b) => a - b);
      const mid = Math.floor(vals.length / 2);
      return vals.length % 2 === 0 ? Math.floor((vals[mid - 1] + vals[mid]) / 2) : vals[mid];
    };

    return {
      fastestFee: clamp(med('fastestFee')),
      halfHourFee: clamp(med('halfHourFee')),
      hourFee: clamp(med('hourFee')),
    };
  }

  async getFeeEstimates(
    inputs: SpendableUtxo[],
    toAddress: string,
    network: Network,
    changeScriptType: ScriptType | null = null,
  ) {
    const { fastestFee, halfHourFee, hourFee } = await this.getReliableFeeRates(network);
    const toScript: ScriptType = scriptTypeFromAddress(toAddress);
    const vbytes = this.estimateTxVbytes(inputs, toScript, changeScriptType);
    const fiatCurrency = preferenceManager.get().fiatCurrency || 'USD';
    const btcPrice = await getBitcoinPrice(fiatCurrency === 'BTC' ? 'USD' : fiatCurrency);
    const feeBtc = (rate: number) => (rate * vbytes) / 1e8;
    const toFiat = (btc: number) => btc * btcPrice;

    return [
      { speed: 'slow', sats: hourFee, btcAmount: feeBtc(hourFee), usdAmount: toFiat(feeBtc(hourFee)) },
      { speed: 'medium', sats: halfHourFee, btcAmount: feeBtc(halfHourFee), usdAmount: toFiat(feeBtc(halfHourFee)) },
      { speed: 'fast', sats: fastestFee, btcAmount: feeBtc(fastestFee), usdAmount: toFiat(feeBtc(fastestFee)) },
    ] as FeeOptionSetting[];
  }

  private estimateTxVbytes(inputs: SpendableUtxo[], toScript: ScriptType, changeScriptType: ScriptType | null = null) {
    const overhead = 10 + 2;
    const assumedInputScript = changeScriptType ?? ScriptType.P2WPKH;
    const ins =
      inputs.length > 0
        ? inputs.reduce((sum, u) => sum + this.IN_VBYTES[u.scriptType] + 1, 0)
        : this.IN_VBYTES[assumedInputScript] + 1;
    const outs = this.OUT_VBYTES[toScript] + (changeScriptType ? this.OUT_VBYTES[changeScriptType] : 0);
    return overhead + ins + outs;
  }

  createFeeSizer(feerateSatPerVb: number, accountScript: ScriptType, toScript: ScriptType): FeeSizer {
    const inVB = this.IN_VBYTES[accountScript];
    const outTo = this.OUT_VBYTES[toScript];
    const outChg = this.OUT_VBYTES[accountScript];

    return (inputCount: number, includeChange: boolean) => {
      const vbytes = 10 + 2 + inputCount * inVB + inputCount + outTo + (includeChange ? outChg : 0);
      return Math.ceil(vbytes * feerateSatPerVb);
    };
  }
}

export const feeService = new FeeService();
