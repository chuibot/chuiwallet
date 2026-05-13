/**
 * CHUI-AUDIT-001 / WEB-W2-001 — provider hijack via window property reassignment.
 *
 * window.ChuiWalletProvider, window.btc, and entries in window.btc_providers
 * are installed as plain writable, configurable properties. A malicious page
 * script (or a malicious dependency loaded by a Blockonomics merchant page)
 * can replace them after the inpage bundle runs.
 *
 * The fix: Object.defineProperty with writable:false, configurable:false for
 * each global. Plus a descriptor self-check on every invocation.
 *
 * This spec verifies the descriptor on the live wallet bundle.
 *
 * Today: FAILS on main.
 * After fix: PASSES.
 */

import { test, expect } from '@playwright/test';

test.describe('CHUI-AUDIT-001 — provider globals are non-writable, non-configurable', () => {
  test('window.ChuiWalletProvider descriptor is locked', async ({ page }) => {
    // Pseudo-code; wire to existing Playwright fixture.
    await page.goto('about:blank');
    const descriptor = await page.evaluate(() => {
      return JSON.stringify(Object.getOwnPropertyDescriptor(window, 'ChuiWalletProvider'));
    });
    const parsed = descriptor ? JSON.parse(descriptor) : null;
    expect(parsed).not.toBeNull();
    // After fix:
    expect(parsed.writable).toBe(false);
    expect(parsed.configurable).toBe(false);
  });

  test('an attacker script cannot replace ChuiWalletProvider after page load', async ({ page }) => {
    await page.goto('about:blank');
    const replaced = await page.evaluate(() => {
      try {
        Object.defineProperty(window, 'ChuiWalletProvider', {
          value: { isAttacker: true },
          configurable: true,
          writable: true,
        });
        return (
          (window as unknown as { ChuiWalletProvider: { isAttacker?: boolean } }).ChuiWalletProvider.isAttacker === true
        );
      } catch {
        return false;
      }
    });
    expect(replaced).toBe(false);
  });
});
