import type { FeeOptionSetting } from '../types/electrum';
import type { SpendableUtxo } from './utxoSelection';
import { ScriptType } from '../types/wallet';
import { scriptTypeFromAddress } from '../utils/crypto';
import { getBitcoinPrice } from './blockonomics';

export type FeeSizer = (inputCount: number, includeChange: boolean) => number;

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
    [ScriptType.P2SH_P2WPKH]: 32, // generic P2SH
    [ScriptType.P2PKH]: 34,
  };

  public DUST: Readonly<Record<ScriptType, number>> = {
    [ScriptType.P2WPKH]: 330,
    [ScriptType.P2TR]: 330, // use same bucket as P2WSH-sized outputs
    [ScriptType.P2SH_P2WPKH]: 330,
    [ScriptType.P2PKH]: 546,
  };

  async getFeeEstimates(inputs: SpendableUtxo[], toAddress: string, changeScriptType: ScriptType | null = null) {
    const res = await fetch('https://mempool.space/api/v1/fees/recommended');
    const { fastestFee, halfHourFee, hourFee } = await res.json();
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
        : this.IN_VBYTES[assumedInputScript] + 1; // assume 1 input if no spendables provided
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
