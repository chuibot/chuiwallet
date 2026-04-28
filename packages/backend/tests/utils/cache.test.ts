import { resetChromeStorage } from '../helpers/chromeMock';
import { getCacheKey, selectByChain } from '../../src/utils/cache';
import { CacheType, ChangeType } from '../../src/types/cache';
import { accountManager } from '../../src/accountManager';
import { Network } from '../../src/types/electrum';
import { ScriptType } from '../../src/types/wallet';

describe('selectByChain', () => {
  it('returns external for ChangeType.External', () => {
    expect(selectByChain('A', 'B', ChangeType.External)).toBe('A');
  });
  it('returns internal for ChangeType.Internal', () => {
    expect(selectByChain('A', 'B', ChangeType.Internal)).toBe('B');
  });
});

describe('getCacheKey', () => {
  beforeEach(async () => {
    resetChromeStorage();
    accountManager.accounts = [];
    accountManager.activeAccountIndex = -1;
    await accountManager.init();
    await accountManager.add({
      name: 'Account #1',
      index: 0,
      network: Network.Mainnet,
      xpub: 'xpub-mock',
      scriptType: ScriptType.P2WPKH,
    });
  });

  it('formats as type_network_chain_index using the active account', () => {
    expect(getCacheKey(CacheType.Address, ChangeType.External)).toBe('address_mainnet_receive_0');
    expect(getCacheKey(CacheType.History, ChangeType.Internal)).toBe('history_mainnet_change_0');
    expect(getCacheKey(CacheType.Utxo, ChangeType.External)).toBe('utxo_mainnet_receive_0');
    expect(getCacheKey(CacheType.Tx, ChangeType.External)).toBe('tx_mainnet_receive_0');
  });

  it('reflects the active account network and HD index', async () => {
    await accountManager.add({
      name: 'Account #2',
      index: 5,
      network: Network.Testnet,
      xpub: 'xpub-mock-2',
      scriptType: ScriptType.P2WPKH,
    });
    expect(getCacheKey(CacheType.Address, ChangeType.Internal)).toBe('address_testnet_change_5');
  });
});
