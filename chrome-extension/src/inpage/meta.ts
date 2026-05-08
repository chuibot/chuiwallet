import type { BtcProviderInfo } from '@src/inpage/types';

export const providerInfo: BtcProviderInfo = Object.freeze({
  id: 'ChuiWalletProvider',
  name: 'Chui Wallet',
  methods: Object.freeze(['getXpub', 'getAddresses', 'getXpubAddresses'] as const),
});
