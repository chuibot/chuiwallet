/**
 * CHUI-AUDIT-012 — Approval popup renders Unicode IDN origin without
 * punycode normalization or bidi-control stripping.
 *
 * The bug: rpc.ts originFromSender returns new URL(sender.url).origin,
 * which is the Unicode form. The popup renders that string verbatim. A
 * homograph domain (xn--pyl-53dca.com a.k.a. visual-paypal-spoof) renders
 * as the spoofable Unicode form.
 *
 * The fix: a displayOrigin() helper that strips bidi controls, runs
 * punycode.toASCII on the hostname, and rejects non-http(s) origins. The
 * popup renders the ASCII form inside <bdi dir="ltr">.
 *
 * This test currently has no fix to import. It declares the contract.
 */

// import { displayOrigin } from '...'; // TODO: import the helper once the fix lands.
declare function displayOrigin(raw: string): string;

describe.skip('CHUI-AUDIT-012 — displayOrigin normalizes IDN and rejects bad protocols', () => {
  it('renders an IDN origin in punycode (xn--*) form', () => {
    expect(displayOrigin('https://xn--pyl-53dca.com')).toBe('https://xn--pyl-53dca.com');
    // Counter-case: a Unicode form must round-trip to ASCII.
    expect(displayOrigin('https://paypаl.com')).toBe('https://xn--paypl-3ve.com');
  });

  it('strips bidi control characters from the hostname', () => {
    expect(displayOrigin('https://example‮.com')).toBe('https://example.com');
  });

  it('rejects chrome-extension://', () => {
    expect(() => displayOrigin('chrome-extension://abcd')).toThrow();
  });

  it('rejects data:', () => {
    expect(() => displayOrigin('data:text/html,...')).toThrow();
  });
});
