import type { RpcErrorObject } from '@src/background/router/rpc';

export interface ChuiWalletProvider {
  isChui: boolean;
  metadata: BtcProviderInfo;
  request: ChuiRequestFn;
}

export interface ChuiRequestFn {
  <T = unknown>(method: string, params?: unknown): Promise<T>;
}

export interface BtcProviderInfo {
  id: string;
  name: string;
  icon?: string;
  webUrl?: string;
  chromeWebStoreUrl?: string;
  methods: string[];
}

export class ChuiRpcError extends Error {
  readonly code: number;
  readonly data?: unknown;

  constructor(error: RpcErrorObject) {
    super(error.message);
    this.name = 'ChuiRpcError';
    this.code = error.code;
    this.data = error.data;
  }
}
