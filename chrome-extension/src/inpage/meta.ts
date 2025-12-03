import type { BtcProviderInfo } from '@src/inpage/types';

// WBIP004-style provider metadata
export const providerInfo: BtcProviderInfo = {
  id: 'ChuiWalletProvider',
  name: 'Chui Wallet',
  // icon: 'data:image/svg+xml;base64,...', // add later
  webUrl: 'https://chuiwallet.example', // add later
  chromeWebStoreUrl: 'https://chromewebstore.google.com/detail/...', // add later
  methods: ['getAddresses', 'getXpub'],
};
