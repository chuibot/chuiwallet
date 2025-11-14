import type { ElectrumTransaction } from '../types/electrum';
import type { AddressEntry, TxEntry, TxStatus, TxType } from '../types/cache';
import { CacheType, ChangeType } from '../types/cache';
import browser from 'webextension-polyfill';
import { getCacheKey } from '../utils/cache';
import { getBitcoinPrice } from './blockonomics';
import { scanManager } from '../scanManager';
import { electrumService } from './electrumService';

type ScriptPubKey = Readonly<{
  address?: string;
  addresses?: readonly string[] | string[];
  type?: string;
  asm?: string;
  hex?: string;
}>;

const toSats = (btc: number | string | undefined): bigint => (btc ? BigInt(Math.round(Number(btc) * 1e8)) : 0n);
const toBtc = (sats: bigint): number => Number(sats) / 1e8;

type InPart = { address: string; valueSat: bigint; mine: boolean };
type OutPart = { address: string; valueSat: bigint; mine: boolean };

export class TxHistoryService {
  private txHistoryCache = new Map<string, TxEntry>();
  private parentTxCache = new Map<string, ElectrumTransaction>();

  public async get(): Promise<TxEntry[]> {
    await this.loadTxHistory();
    const histories = [...scanManager['historyCacheReceive'].values(), ...scanManager['historyCacheChange'].values()];
    const bitcoinPrice = await getBitcoinPrice();

    for (const entry of histories) {
      for (const [txid] of entry.txs) {
        if (!Array.from(this.txHistoryCache.values()).some(e => e.transactionHash === txid)) {
          const tx = (await electrumService.getRawTransaction(txid, true)) as ElectrumTransaction;
          const newEntry = await this.buildTxEntry(
            tx,
            scanManager.addressCacheReceive,
            scanManager.addressCacheChange,
            bitcoinPrice,
          );
          this.txHistoryCache.set(txid, newEntry);
        }
      }
    }

    await this.saveTxHistory();
    return Array.from(this.txHistoryCache.values()).sort((a, b) => b.timestamp - a.timestamp);
  }

  private async buildTxEntry(
    tx: ElectrumTransaction,
    addressCacheReceive: Map<number, AddressEntry>,
    addressCacheChange: Map<number, AddressEntry>,
    btcUsdRate?: number,
  ): Promise<TxEntry> {
    const myReceiveSet = this.buildAddressSet(addressCacheReceive);
    const myChangeSet = this.buildAddressSet(addressCacheChange);
    const myAllSet = new Set<string>([...myReceiveSet, ...myChangeSet]);

    const inputs: InPart[] = await this.resolveInputs(tx, myAllSet);
    const outputs: OutPart[] = this.resolveOutputs(tx, myAllSet);

    const inTotalSat = inputs.reduce((s, i) => s + i.valueSat, 0n);
    const outTotalSat = outputs.reduce((s, o) => s + o.valueSat, 0n);
    const feeSat = inTotalSat > 0n && inTotalSat > outTotalSat ? inTotalSat - outTotalSat : 0n;

    const anyInMine = inputs.some(i => i.mine);
    const anyOutMine = outputs.some(o => o.mine);

    let type: TxType;
    if (anyInMine) type = 'SEND';
    else if (anyOutMine) type = 'RECEIVE';
    else type = 'RECEIVE';

    const isOpReturn = (spk: ScriptPubKey | undefined) =>
      spk?.type === 'nulldata' || (typeof spk?.asm === 'string' && spk.asm.startsWith('OP_RETURN'));

    const changeSat = tx.vout.reduce((s, v) => {
      const addr = this.addrFromScript(v.scriptPubKey);
      if (addr && myChangeSet.has(addr)) return s + toSats(v.value);
      return s;
    }, 0n);

    const opReturnSat = tx.vout.reduce((s, v) => (isOpReturn(v.scriptPubKey) ? s + toSats(v.value) : s), 0n);

    let amountSat: bigint;
    if (type === 'RECEIVE') {
      // Everything that arrived to our wallet in this tx (we didn’t spend inputs)
      amountSat = outputs.filter(o => o.mine).reduce((s, o) => s + o.valueSat, 0n);
    } else {
      // Outgoing to others = all outputs - change - OP_RETURN(usually 0 anyway)
      const sent = outTotalSat - changeSat - opReturnSat;
      amountSat = sent > 0n ? sent : 0n;
    }

    const { sender, receiver } = this.pickSenderReceiverFromOutputs(type, inputs, tx, myChangeSet);

    const status: TxStatus = tx.confirmations && tx.confirmations > 0 ? 'CONFIRMED' : 'PENDING';
    const rawTs = (tx.time ?? tx.blocktime ?? Math.floor(Date.now() / 1000)) as number;
    const tsMs = rawTs > 1e12 ? rawTs : rawTs * 1000;

    const amountBtc = toBtc(amountSat);
    const feeBtc = toBtc(feeSat);
    const amountUsd = btcUsdRate ? amountBtc * btcUsdRate : 0;
    const feeUsd = btcUsdRate ? feeBtc * btcUsdRate : 0;

    return {
      type,
      status,
      amountBtc,
      amountUsd,
      feeBtc,
      feeUsd,
      timestamp: tsMs,
      confirmations: tx.confirmations ?? 0,
      transactionHash: tx.txid,
      sender,
      receiver,
    };
  }

  private buildAddressSet(cache: Map<number, AddressEntry>): Set<string> {
    const s = new Set<string>();
    for (const [, e] of cache) s.add(e.address.toLowerCase());
    return s;
  }

  private addrFromScript(spk: ScriptPubKey | undefined): string {
    if (!spk) return '';
    if (spk.address) return String(spk.address).toLowerCase();
    const arr = spk.addresses;
    if (Array.isArray(arr) && arr.length > 0) return String(arr[0]).toLowerCase();
    return '';
  }

  private async resolveInputs(tx: ElectrumTransaction, myAllSet: Set<string>): Promise<InPart[]> {
    const results: InPart[] = [];
    for (const vin of tx.vin) {
      if (!vin.txid) continue; // coinbase etc.
      const parent = await this.getParentTx(vin.txid);
      const prev = parent?.vout?.[vin.vout];
      const addr = this.addrFromScript(prev?.scriptPubKey as ScriptPubKey | undefined);
      const valueSat = toSats(prev?.value as number | string | undefined);
      const mine = addr !== '' && myAllSet.has(addr);
      results.push({ address: addr, valueSat, mine });
    }
    return results;
  }

  private resolveOutputs(tx: ElectrumTransaction, myAllSet: Set<string>): OutPart[] {
    const outs: OutPart[] = [];
    for (const vout of tx.vout) {
      const address = this.addrFromScript(vout.scriptPubKey as ScriptPubKey | undefined);
      const valueSat = toSats(vout.value as number | string | undefined);
      const mine = address !== '' && myAllSet.has(address);
      outs.push({ address, valueSat, mine });
    }
    return outs;
  }

  private async getParentTx(txid: string): Promise<ElectrumTransaction> {
    const cached = this.parentTxCache.get(txid);
    if (cached) return cached;
    const tx = (await electrumService.getRawTransaction(txid, true)) as ElectrumTransaction;
    this.parentTxCache.set(txid, tx);
    return tx;
  }

  private pickSenderReceiverFromOutputs(
    txType: TxType,
    inputs: InPart[],
    tx: ElectrumTransaction,
    myChangeSet: Set<string>,
  ): { sender: string; receiver: string } {
    // Narrow vout shape without using `any`
    const vouts = tx.vout as ReadonlyArray<{
      value: number | string;
      scriptPubKey?: ScriptPubKey;
    }>;

    if (txType === 'SEND') {
      const sender = inputs.find(i => i.mine)?.address || '';

      // external = not change, not OP_RETURN, has address
      const externals = vouts
        .map(v => {
          const addr = this.addrFromScript(v.scriptPubKey);
          const isChange = addr !== '' && myChangeSet.has(addr);
          const isOpRet = this.isOpReturn(v.scriptPubKey);
          return { addr, valueSat: toSats(v.value), isChange, isOpRet };
        })
        .filter(x => x.addr !== '' && !x.isChange && !x.isOpRet);

      const receiver = externals.sort((a, b) => Number(b.valueSat - a.valueSat))[0]?.addr || '';
      return { sender, receiver };
    } else {
      const sender = inputs.find(i => !i.mine)?.address || '';

      // ours = outputs to us (receive or change), exclude OP_RETURN
      const ours = vouts
        .map(v => {
          const addr = this.addrFromScript(v.scriptPubKey);
          const isOpRet = this.isOpReturn(v.scriptPubKey);
          return { addr, valueSat: toSats(v.value), isOpRet };
        })
        .filter(x => x.addr !== '' && !x.isOpRet);

      const receiver = ours.sort((a, b) => Number(b.valueSat - a.valueSat))[0]?.addr || '';
      return { sender, receiver };
    }
  }

  private isOpReturn(spk: ScriptPubKey | undefined): boolean {
    return !!(spk && (spk.type === 'nulldata' || (typeof spk.asm === 'string' && spk.asm.startsWith('OP_RETURN'))));
  }

  private async saveTxHistory() {
    const cacheKey = getCacheKey(CacheType.Tx, ChangeType.External);
    const txHistorySerialised = Array.from(this.txHistoryCache.entries());
    await browser.storage.local.set({ [cacheKey]: txHistorySerialised });
  }

  private async loadTxHistory() {
    const cacheKey = getCacheKey(CacheType.Tx, ChangeType.External);
    const txHistory = await browser.storage.local.get(cacheKey);
    if (Object.keys(txHistory).length === 0) {
      await this.saveTxHistory();
    } else {
      this.txHistoryCache.clear();
      const storedTxHistory = (txHistory[cacheKey] as [string, TxEntry][]) ?? [];
      for (const [txid, entry] of storedTxHistory) this.txHistoryCache.set(txid, entry);
    }
  }

  public async clearCache(): Promise<void> {
    try {
      await browser.storage.local.remove(getCacheKey(CacheType.Tx, ChangeType.External));
    } catch (e) {
      console.error(e);
    } finally {
      this.txHistoryCache.clear();
      this.parentTxCache.clear();
    }
  }
}

export const historyService = new TxHistoryService();
