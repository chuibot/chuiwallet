/**
 * Default config for mainnet/testnet Electrum, mempool API, gap limit, etc.
 * We are storing user-chosen network in DB, but keep these defaults for fallback.
 */

export const ELECTRUM_MAINNET = {
  host: "blockstream.info",
  port: 993,
  protocol: "ssl",
};

export const ELECTRUM_TESTNET = {
  host: "testnet.blockstream.info",
  port: 993,
  protocol: "ssl",
};

export const MEMPOOL_API_MAINNET =
  "https://mempool.space/api/v1/fees/recommended";
export const MEMPOOL_API_TESTNET =
  "https://mempool.space/testnet/api/v1/fees/recommended";

export const DEFAULT_GAP_LIMIT = 20;
export const MAX_ADDRESSES = 500;
