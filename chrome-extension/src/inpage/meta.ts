import type { BtcProviderInfo } from '@src/inpage/types';

export const providerInfo: BtcProviderInfo = Object.freeze({
  id: 'ChuiWalletProvider',
  name: 'Chui Wallet',
  webUrl: 'https://chuiwallet.com/',
  chromeWebStoreUrl: 'https://chromewebstore.google.com/detail/...', //To be updated upon approval
  methods: Object.freeze(['getXpub', 'getAddresses', 'getXpubAddresses'] as const),
});
