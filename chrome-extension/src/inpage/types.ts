import type { RpcErrorObject } from '@src/background/messaging/rpc';

export interface ChuiWalletProvider {
  isChui: boolean;
  metadata: BtcProviderInfo;
  request: ChuiRequestFn;
}

export interface ChuiRequestFn {
  <T = unknown>(method: string, params?: unknown): Promise<T>;
}

export type ChuiProviderMethod = 'getXpub' | 'getAddresses' | 'getXpubAddresses';

export interface BtcProviderInfo {
  id: string;
  name: string;
  icon?: string;
  webUrl?: string;
  chromeWebStoreUrl?: string;
  methods: ChuiProviderMethod[];
}

export interface ChuiProviderAddresses {
  bitcoin: {
    xpub?: string | null;
    receivingAddress: string | null;
    changeAddress: string | null;
  };
  evm: {
    address: string | null;
  };
}

export type ChuiProviderXpubAddresses = ChuiProviderAddresses & {
  bitcoin: ChuiProviderAddresses['bitcoin'] & {
    xpub: string | null;
  };
};

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
