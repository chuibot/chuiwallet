import { CacheType, ChangeType } from '../types/cache';
import { accountManager } from '../accountManager';
import type { Account } from '../types/wallet';

export function getAccountCacheKey(
  account: Pick<Account, 'network' | 'index'>,
  type: string = CacheType.Address,
  chain: string = ChangeType.External,
): string {
  return `${type}_${account.network}_${chain}_${account.index}`;
}

export function getCacheKey(type: string = CacheType.Address, chain: string = ChangeType.External): string {
  return getAccountCacheKey(accountManager.getActiveAccount(), type, chain);
}

export function selectByChain<T>(external: T, internal: T, changeType: ChangeType): T {
  return changeType === ChangeType.External ? external : internal;
}
