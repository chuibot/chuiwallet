import type { FeeOptionSetting } from '../types/electrum';
import type { SpendableUtxo } from './utxoSelection';
import { ScriptType } from '../types/wallet';
import { scriptTypeFromAddress } from '../utils/crypto';
import { getBitcoinPrice } from './blockonomics';
import { Network } from '../types/electrum';

export type FeeSizer = (inputCount: number, includeChange: boolean) => number;

type FeeRates = { fastestFee: number; halfHourFee: number; hourFee: number };

const FALLBACK_FEES: FeeRates = {
  fastestFee: 10,
  halfHourFee: 5,
  hourFee: 2,
};

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
    return await res.json();
  }

  private async fetchBlockstream(network: Network): Promise<FeeRates> {
    const baseUrl =
      network === Network.Mainnet ? 'https://blockstream.info/api' : 'https://blockstream.info/testnet/api';
    const res = await fetchWithTimeout(`${baseUrl}/fee-estimates`);
    const estimates = await res.json();
    return {
      fastestFee: Math.ceil(estimates['1'] || estimates['2'] || 10),
      halfHourFee: Math.ceil(estimates['3'] || estimates['6'] || 5),
      hourFee: Math.ceil(estimates['12'] || estimates['24'] || 2),
    };
  }

  private async fetchBlockchainInfo(): Promise<FeeRates> {
    const res = await fetchWithTimeout('https://api.blockchain.info/mempool/fees');
    const data = await res.json();
    return {
      fastestFee: data.priority,
      halfHourFee: data.regular,
      hourFee: Math.max(1, data.regular - 1),
    };
  }

  private async getReliableFeeRates(network: Network): Promise<FeeRates> {
    const providers = [this.fetchMempool(network), this.fetchBlockstream(network)];

    if (network === Network.Mainnet) {
      providers.push(this.fetchBlockchainInfo());
    }

    try {
      return await Promise.any(providers);
    } catch (e) {
      console.error('All fee providers failed or timed out, using fallback', e);
      return FALLBACK_FEES;
    }
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
    const btcPrice = await getBitcoinPrice();
    const feeBtc = (rate: number) => (rate * vbytes) / 1e8;
    const toUsd = (btc: number) => btc * btcPrice;

    return [
      { speed: 'slow', sats: hourFee, btcAmount: feeBtc(hourFee), usdAmount: toUsd(feeBtc(hourFee)) },
      { speed: 'medium', sats: halfHourFee, btcAmount: feeBtc(halfHourFee), usdAmount: toUsd(feeBtc(halfHourFee)) },
      { speed: 'fast', sats: fastestFee, btcAmount: feeBtc(fastestFee), usdAmount: toUsd(feeBtc(fastestFee)) },
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
