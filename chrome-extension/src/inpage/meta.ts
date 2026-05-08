import type { BtcProviderInfo } from '@src/inpage/types';

export const providerInfo: BtcProviderInfo = Object.freeze({
  id: 'ChuiWalletProvider',
  name: 'Chui Wallet',
  webUrl: 'https://chuiwallet.example',
  chromeWebStoreUrl: 'https://chromewebstore.google.com/detail/...',
  methods: Object.freeze(['getXpub', 'getAddresses', 'getXpubAddresses'] as const),
});
