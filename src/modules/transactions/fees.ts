import fetch from "cross-fetch";
import { getWalletSettings } from "../../settings/walletSettings";
import { MEMPOOL_API_MAINNET, MEMPOOL_API_TESTNET } from "../../config";

export interface FeeEstimates {
  fastFeeRate: number;
  mediumFeeRate: number;
  slowFeeRate: number;
}

/**
 * Fetch recommended fees from mempool.space for mainnet or testnet
 */
export async function getFeeEstimates(): Promise<FeeEstimates> {
  const settings = await getWalletSettings();
  const api =
    settings.network === "mainnet" ? MEMPOOL_API_MAINNET : MEMPOOL_API_TESTNET;

  const res = await fetch(api);
  if (!res.ok) {
    throw new Error(`Failed to fetch fees: ${res.status}`);
  }
  const data = await res.json();
  return {
    fastFeeRate: data.fastestFee || 25,
    mediumFeeRate: data.halfHourFee || 15,
    slowFeeRate: data.hourFee || 5,
  };
}
