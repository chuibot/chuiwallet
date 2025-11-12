import type { AddressEntry, HistoryEntry, UtxoEntry } from './types/cache';
import { CacheType, ChangeType } from './types/cache';
import browser from 'webextension-polyfill';
import { addressToScriptHash, toBitcoinNetwork } from './utils/crypto';
import { getCacheKey, selectByChain } from './utils/cache';
import { walletManager } from './walletManager';
import { preferenceManager } from './preferenceManager';
import { electrumService } from './modules/electrumService';
import { logger } from './utils/logger';

export interface ScanManagerConfig {
  externalGapLimit: number;
  internalGapLimit: number;
  forwardExtendMaxPasses: number;
  staleBatchSize: number;
  electrumBatchSize: number;
  pruneThresholdDays: number;
}

export const defaultScanConfig: ScanManagerConfig = {
  externalGapLimit: 500,
  internalGapLimit: 20,
  forwardExtendMaxPasses: 10,
  staleBatchSize: 60,
  electrumBatchSize: 20,
  pruneThresholdDays: 7,
};

export class ScanManager {
  private config: ScanManagerConfig;
  public addressCacheReceive = new Map<number, AddressEntry>();
  public addressCacheChange = new Map<number, AddressEntry>();
  private historyCacheReceive = new Map<number, HistoryEntry>();
  private historyCacheChange = new Map<number, HistoryEntry>();
  private utxoCacheReceive = new Map<number, UtxoEntry>();
  private utxoCacheChange = new Map<number, UtxoEntry>();
  private highestScannedReceive = -1;
  private highestScannedChange = -1;
  private highestUsedReceive = -1;
  private highestUsedChange = -1;
  public nextReceiveIndex = 0;
  public nextChangeIndex = 0;

  constructor(config: ScanManagerConfig = defaultScanConfig) {
    this.config = { ...config };
  }

  public async init() {
    await this.loadAddress();
    await this.loadHistory();
    await this.loadUtxo();
    this.initHighestScanned();
    this.initHighestUsed();
    console.log(`Highest Scanned (Receive|Change): ${this.highestScannedReceive} | ${this.highestScannedChange}`);
    console.log(`Highest Used (Receive|Change): ${this.highestUsedReceive} | ${this.highestUsedChange}`);
  }

  /**
   * Forward scan the address chain by deriving to gapLimit
   * @param changeType
   */
  public async forwardScan(changeType: ChangeType = ChangeType.External) {
    let passes = 0;
    while (passes < this.config.forwardExtendMaxPasses) {
      const gapLimit = selectByChain(this.config.externalGapLimit, this.config.internalGapLimit, changeType);
      const highestUsed = selectByChain(this.highestUsedReceive, this.highestUsedChange, changeType);
      const highestScanned = selectByChain(this.highestScannedReceive, this.highestScannedChange, changeType);
      const windowToScan = Math.max(0, highestUsed) + gapLimit - highestScanned - 1;
      if (windowToScan <= 0) {
        logger.log(`Forward scan up-to-date (used=${highestUsed}, scanned=${highestScanned}, gap=${gapLimit})`);
        break;
      }

      const startIndex = highestScanned + 1;
      const endIndex = startIndex + windowToScan - 1;

      // derive missing first
      await this.derive(startIndex, endIndex, changeType);

      // Build indices to scan
      const indices = [];
      for (let i = startIndex; i <= endIndex; i++) {
        indices.push(i);
      }
      await this.scan(indices, changeType);
      passes++;
    }
  }

  /**
   * Backfill scan continuously scan unused derived addresses within threshold limit (days) order by staleness, in batch of staleBatchSize
   * @param changeType
   */
  public async backfillScan(changeType: ChangeType = ChangeType.External) {
    const gapLimit = selectByChain(this.config.externalGapLimit, this.config.internalGapLimit, changeType);
    const highestUsed = selectByChain(this.highestUsedReceive, this.highestUsedChange, changeType);
    const highestScanned = selectByChain(this.highestScannedReceive, this.highestScannedChange, changeType);
    const addressCache = selectByChain(this.addressCacheReceive, this.addressCacheChange, changeType);
    const historyCache = selectByChain(this.historyCacheReceive, this.historyCacheChange, changeType);
    const utxoCache = selectByChain(this.utxoCacheReceive, this.utxoCacheChange, changeType);

    // Nothing derived yet
    if (highestScanned < 0) return;

    // Backfill window: only within derived space, bounded by highestUsed + gap
    const windowEnd = Math.min(highestScanned, Math.max(0, highestUsed) + gapLimit);
    const usedPending: number[] = [];
    const staleUnused: Array<{ index: number; lastChecked: number }> = [];
    for (let idx = 0; idx <= windowEnd; idx++) {
      const addr = addressCache.get(idx);
      if (!addr) continue;

      // Check index is used but pending
      if (this.isPendingIndex(idx, historyCache, utxoCache)) {
        usedPending.push(idx);
        continue;
      }

      // Check unused candidate
      if (!addr.everUsed) {
        staleUnused.push({ index: idx, lastChecked: addr.lastChecked || 0 });
      }
    }

    staleUnused.sort((a, b) => a.lastChecked - b.lastChecked);
    const room = Math.max(0, this.config.staleBatchSize - usedPending.length);
    const pickUnused = staleUnused.slice(0, room).map(x => x.index);
    const indicesToScan = Array.from(new Set([...usedPending, ...pickUnused]));
    if (indicesToScan.length === 0) return;

    const MAX_LOG = 100;
    const preview =
      indicesToScan.length > MAX_LOG
        ? `${indicesToScan.slice(0, MAX_LOG).join(', ')} … (+${indicesToScan.length - MAX_LOG} more)`
        : indicesToScan.join(', ');
    logger.log(`Backfill ct=${changeType} | scanning ${indicesToScan.length} indices: [${preview}]`);
    await this.scan(indicesToScan, changeType);
  }

  private async derive(startIndex: number, endIndex: number, changeType: ChangeType = ChangeType.External) {
    logger.log(`Scanning from ${startIndex} to ${endIndex} (${endIndex - startIndex} Indexes)`);
    const addressCache = changeType === ChangeType.External ? this.addressCacheReceive : this.addressCacheChange;
    for (let index = startIndex; index <= endIndex; index++) {
      if (!addressCache.has(index)) {
        const nowTimestamp = Date.now();
        const address = walletManager.deriveAddress(changeType === ChangeType.External ? 0 : 1, index);
        if (!address) {
          throw new Error('Unable to derive address');
        }
        const entry: AddressEntry = {
          address,
          firstSeen: nowTimestamp,
          lastChecked: 0,
          everUsed: false,
        };
        addressCache.set(index, entry);
      }
    }
    this.bumpHighestScanned(endIndex, changeType);
    await this.saveAddress();
  }

  private async scan(indices: number[], changeType: ChangeType = ChangeType.External) {
    const bitcoinNetwork = toBitcoinNetwork(preferenceManager.get().activeNetwork);
    const addressCache = changeType === ChangeType.External ? this.addressCacheReceive : this.addressCacheChange;
    const historyCache = changeType === ChangeType.External ? this.historyCacheReceive : this.historyCacheChange;
    const utxoCache = changeType === ChangeType.External ? this.utxoCacheReceive : this.utxoCacheChange; // Assume added

    // Batch in groups for concurrency (adjust based on Electrum limits)
    for (let i = 0; i < indices.length; i += this.config.electrumBatchSize) {
      // Bootstrap for batch scanning
      const batchTimestamp = Date.now();
      const batch = indices.slice(i, i + this.config.electrumBatchSize);
      logger.log(`Scanning ${changeType} addresses ${batch} `);
      const scriptHashesPromises = batch.map(async index => {
        const entry = addressCache.get(index);
        if (!entry) return undefined;
        const scriptHash = addressToScriptHash(entry.address, bitcoinNetwork);
        return [scriptHash];
      });
      const scriptHashes: string[][] = (await Promise.all(scriptHashesPromises)).filter(
        (item): item is string[] => item !== undefined,
      );

      // Scan Histories
      const histories = await electrumService.getHistoryBatch(scriptHashes);
      for (let batchIndex = 0; batchIndex < batch.length; batchIndex++) {
        const hdIndex = batch[batchIndex]; // map back from batch pos → HD index
        const entry = addressCache.get(hdIndex);
        if (!entry) continue;

        entry.lastChecked = batchTimestamp;
        const history = histories[batchIndex] ?? [];
        if (history.length > 0) {
          entry.everUsed = true;
          this.upsertHistoryIfUsed(historyCache, hdIndex, batchTimestamp, history);
          this.bumpHighestUsed(hdIndex, changeType);
        }
      }
      await this.saveHistory();

      // Scan Utxo
      const utxosByIndex = await electrumService.getUtxoBatch(scriptHashes);
      for (let batchIndex = 0; batchIndex < batch.length; batchIndex++) {
        const hdIndex = batch[batchIndex];
        const entry = addressCache.get(hdIndex);
        if (!entry) continue;

        const utxos = utxosByIndex[batchIndex] ?? [];
        if (utxos.length > 0) {
          entry.lastChecked = batchTimestamp;
          this.upsertUtxo(utxoCache, hdIndex, batchTimestamp, utxos);
          this.bumpHighestUsed(hdIndex, changeType);
        }
      }
      await this.saveUtxo();
      await this.saveAddress();
    }
  }

  private upsertHistoryIfUsed(
    cache: Map<number, HistoryEntry>,
    hdIndex: number,
    ts: number,
    history: { tx_hash: string; height: number }[],
  ) {
    if (!history || history.length === 0) return;
    cache.set(hdIndex, {
      lastChecked: ts,
      txs: history.map(tx => [tx.tx_hash, tx.height] as [string, number]),
    });
  }

  private upsertUtxo(
    cache: Map<number, UtxoEntry>,
    hdIndex: number,
    ts: number,
    utxos: { tx_hash: string; tx_pos: number; value: number; height: number }[],
  ) {
    cache.set(hdIndex, {
      lastChecked: ts,
      utxos: utxos.map(utxo => ({
        txid: utxo.tx_hash,
        vout: utxo.tx_pos,
        value: utxo.value,
        height: utxo.height,
      })),
    });
  }

  private bumpHighestScanned(endIndex: number, changeType: ChangeType) {
    if (changeType === ChangeType.External) {
      this.highestScannedReceive = Math.max(this.highestScannedReceive, endIndex);
    } else {
      this.highestScannedChange = Math.max(this.highestScannedChange, endIndex);
    }
  }

  private bumpHighestUsed(index: number, changeType: ChangeType) {
    if (changeType === ChangeType.External) {
      this.highestUsedReceive = Math.max(this.highestUsedReceive, index);
      this.nextReceiveIndex = this.highestUsedReceive + 1;
    } else {
      this.highestUsedChange = Math.max(this.highestUsedChange, index);
      this.nextChangeIndex = this.highestUsedChange + 1;
    }
  }

  private initHighestScanned() {
    this.highestScannedReceive = this.getHighestIndex(this.addressCacheReceive);
    this.highestScannedChange = this.getHighestIndex(this.addressCacheChange);
  }

  private initHighestUsed() {
    this.highestUsedReceive = this.getHighestIndex(this.historyCacheReceive);
    this.highestUsedChange = this.getHighestIndex(this.historyCacheChange);
    this.nextReceiveIndex = this.highestUsedReceive + 1;
    this.nextChangeIndex = this.highestUsedChange + 1;
  }

  private getHighestIndex(map: Map<number, unknown>): number {
    if (map.size === 0) return -1;
    let max = -Infinity;
    for (const k of map.keys()) {
      max = Math.max(max, k);
    }
    return max;
  }

  private isPendingIndex(idx: number, historyCache: Map<number, HistoryEntry>, utxoCache: Map<number, UtxoEntry>) {
    const history = historyCache.get(idx);
    if (history?.txs?.some(([, h]) => h <= 0)) return true;
    const utxo = utxoCache.get(idx);
    if (utxo?.utxos?.some(u => u.height <= 0)) return true; // 0 for unconfirmed
    return false;
  }

  private async saveAddress() {
    const receiveKey = getCacheKey(CacheType.Address, ChangeType.External);
    const changeKey = getCacheKey(CacheType.Address, ChangeType.Internal);
    const receiveSerialised = Array.from(this.addressCacheReceive);
    const changeSerialised = Array.from(this.addressCacheChange);
    await browser.storage.local.set({ [receiveKey]: receiveSerialised });
    await browser.storage.local.set({ [changeKey]: changeSerialised });
  }

  private async loadAddress() {
    const receiveKey = getCacheKey(CacheType.Address, ChangeType.External);
    const changeKey = getCacheKey(CacheType.Address, ChangeType.Internal);
    const receiveAddresses = await browser.storage.local.get(receiveKey);
    const changeAddresses = await browser.storage.local.get(changeKey);
    if (Object.keys(receiveAddresses).length === 0 || Object.keys(changeAddresses).length === 0) {
      // Save empty address map to initialize data structure
      await this.saveAddress();
    } else {
      this.addressCacheReceive.clear();
      const storedReceive = receiveAddresses[receiveKey] as [number, AddressEntry][];
      for (const [index, entry] of storedReceive) {
        this.addressCacheReceive.set(index, entry);
      }
      const storedChange = changeAddresses[changeKey] as [number, AddressEntry][];
      for (const [index, entry] of storedChange) {
        this.addressCacheChange.set(index, entry);
      }
    }
  }

  private async saveHistory() {
    const receiveKey = getCacheKey(CacheType.History, ChangeType.External);
    const changeKey = getCacheKey(CacheType.History, ChangeType.Internal);
    const receiveSerialised = Array.from(this.historyCacheReceive);
    const changeSerialised = Array.from(this.historyCacheChange);
    await browser.storage.local.set({ [receiveKey]: receiveSerialised });
    await browser.storage.local.set({ [changeKey]: changeSerialised });
  }

  private async loadHistory() {
    const receiveKey = getCacheKey(CacheType.History, ChangeType.External);
    const changeKey = getCacheKey(CacheType.History, ChangeType.Internal);
    const receiveHistory = await browser.storage.local.get(receiveKey);
    const changeHistory = await browser.storage.local.get(changeKey);
    if (Object.keys(receiveHistory).length === 0 || Object.keys(changeHistory).length === 0) {
      // Save empty history map to initialize data structure
      await this.saveHistory();
    } else {
      this.historyCacheReceive.clear();
      const storedReceive = receiveHistory[receiveKey] as [number, HistoryEntry][];
      for (const [index, entry] of storedReceive) {
        this.historyCacheReceive.set(index, entry);
      }
      const storedChange = changeHistory[changeKey] as [number, HistoryEntry][];
      for (const [index, entry] of storedChange) {
        this.historyCacheChange.set(index, entry);
      }
    }
  }

  private async saveUtxo() {
    const receiveKey = getCacheKey(CacheType.Utxo, ChangeType.External);
    const changeKey = getCacheKey(CacheType.Utxo, ChangeType.Internal);
    const receiveSerialised = Array.from(this.utxoCacheReceive);
    const changeSerialised = Array.from(this.utxoCacheChange);
    await browser.storage.local.set({ [receiveKey]: receiveSerialised });
    await browser.storage.local.set({ [changeKey]: changeSerialised });
  }

  private async loadUtxo() {
    const receiveKey = getCacheKey(CacheType.Utxo, ChangeType.External);
    const changeKey = getCacheKey(CacheType.Utxo, ChangeType.Internal);
    const receiveUtxo = await browser.storage.local.get(receiveKey);
    const changeUtxo = await browser.storage.local.get(changeKey);
    if (Object.keys(receiveUtxo).length === 0 || Object.keys(changeUtxo).length === 0) {
      // Save empty utxo map to initialize data structure
      await this.saveUtxo();
    } else {
      this.utxoCacheReceive.clear();
      const storedReceive = receiveUtxo[receiveKey] as [number, UtxoEntry][];
      for (const [index, entry] of storedReceive) {
        this.utxoCacheReceive.set(index, entry);
      }
      const storedChange = changeUtxo[changeKey] as [number, UtxoEntry][];
      for (const [index, entry] of storedChange) {
        this.utxoCacheChange.set(index, entry);
      }
    }
  }

  public async clearCache() {
    try {
      const keys = [
        getCacheKey(CacheType.Address, ChangeType.External),
        getCacheKey(CacheType.Address, ChangeType.Internal),
        getCacheKey(CacheType.History, ChangeType.External),
        getCacheKey(CacheType.History, ChangeType.Internal),
        getCacheKey(CacheType.Utxo, ChangeType.External),
        getCacheKey(CacheType.Utxo, ChangeType.Internal),
      ];
      //Todo: clear for multiple accounts
      await browser.storage.local.remove(keys);
    } catch (e) {
      logger.error(e);
    } finally {
      this.clear();
    }
  }

  public clear() {
    this.addressCacheReceive.clear();
    this.addressCacheChange.clear();
    this.historyCacheReceive.clear();
    this.historyCacheChange.clear();
    this.utxoCacheReceive.clear();
    this.utxoCacheChange.clear();
    this.highestScannedReceive = -1;
    this.highestScannedChange = -1;
    this.highestUsedReceive = -1;
    this.highestUsedChange = -1;
    this.nextReceiveIndex = 0;
    this.nextChangeIndex = 0;
  }
}

export const scanManager = new ScanManager();
