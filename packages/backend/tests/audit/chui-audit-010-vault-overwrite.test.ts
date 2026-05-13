/**
 * CHUI-AUDIT-010 — wallet.create silently overwrites an existing vault.
 *
 * The bug: wallet.create checks `if (this.root)` to detect re-create, but
 * `this.root` is only hydrated on unlock. With the wallet locked or with
 * the SW respawned, the in-memory root is null even when an encrypted
 * vault exists on disk. wallet.create then generates a fresh mnemonic and
 * overwrites chrome.storage.local.wallet, destroying the old seed.
 *
 * The fix: gate on `if (this.encryptedVault !== null)` (storage presence),
 * not in-memory state.
 *
 * Today: FAILS on main.
 * After fix: PASSES.
 */

import { Wallet } from '../../src/modules/wallet';

describe('CHUI-AUDIT-010 — wallet.create refuses to overwrite an existing vault', () => {
  it('throws WALLET_ALREADY_EXISTS when an encrypted vault is on disk and root is null', async () => {
    const wallet = new Wallet();
    // Simulate the realistic state: vault on disk, root not hydrated (locked or post-SW-restart).
    (wallet as unknown as { encryptedVault: string }).encryptedVault = 'PRE_EXISTING_CIPHERTEXT';
    (wallet as unknown as { root: null }).root = null;

    await expect(wallet.create({ password: 'p455w0rd' })).rejects.toThrow(/already exists?/i);
  });
});
