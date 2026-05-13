/**
 * CHUI-AUDIT-004 / CRYPTO-W2-001 — broadcast txid must be locally computed.
 *
 * The bug: electrumService.broadcastTx returns whatever the server sends back,
 * and walletManager.sendPayment forwards that into historyService.addOptimisticPending.
 * A malicious Electrum server can therefore plant an attacker-controlled "pending"
 * entry in the user's tx history, which renders as a SEND/PENDING for whatever
 * recipient and amount the wallet computed locally - tied to the WRONG txid.
 *
 * The fix: ignore the server reply and compute the txid locally with
 * bitcoin.Transaction.fromHex(rawTxHex).getId().
 *
 * This test currently FAILS on main (8f53021). It passes once the fix lands.
 */

import * as bitcoin from 'bitcoinjs-lib';
import { ElectrumService } from '../../src/modules/electrumService';

describe('CHUI-AUDIT-004 — broadcast txid is locally computed', () => {
  it('returns the locally-derived txid even when the server lies', async () => {
    // A real tx hex (any valid serialization works for this test).
    // For the placeholder, build a synthetic tx so the test does not depend on
    // a fixture file.
    const tx = new bitcoin.Transaction();
    tx.addInput(Buffer.alloc(32, 1), 0);
    tx.addOutput(Buffer.from('00149c8e8b...', 'hex'), 50_000n as unknown as number);
    const rawTxHex = tx.toHex();
    const realTxid = tx.getId();

    const attackerTxid = 'a'.repeat(64);

    const fakeRpcClient = {
      sendRequest: async (method: string, params: unknown[]) => {
        expect(method).toBe('blockchain.transaction.broadcast');
        expect(params).toEqual([rawTxHex.toLowerCase()]);
        return attackerTxid;
      },
    };

    const svc = new ElectrumService();
    (svc as unknown as { rpcClient: unknown }).rpcClient = fakeRpcClient;

    const returnedTxid = await svc.broadcastTx(rawTxHex);

    // After the fix, returnedTxid MUST equal realTxid, not the server reply.
    expect(returnedTxid).toBe(realTxid);
    expect(returnedTxid).not.toBe(attackerTxid);
  });
});
