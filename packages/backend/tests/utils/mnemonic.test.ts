import { generateMnemonic, validateMnemonic } from '../../src/utils/mnemonic';

describe('mnemonic helpers', () => {
  it('generates a 12-word valid BIP39 mnemonic', () => {
    const m = generateMnemonic();
    expect(m.split(' ')).toHaveLength(12);
    expect(validateMnemonic(m)).toBe(true);
  });

  it('generates fresh mnemonics each call', () => {
    const a = generateMnemonic();
    const b = generateMnemonic();
    expect(a).not.toEqual(b);
  });

  it('rejects an invalid mnemonic', () => {
    expect(validateMnemonic('not a real mnemonic at all')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(validateMnemonic('')).toBe(false);
  });

  it('rejects a phrase with a non-wordlist token', () => {
    expect(
      validateMnemonic('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon zzzz'),
    ).toBe(false);
  });

  it('accepts the canonical BIP39 test vector', () => {
    expect(
      validateMnemonic('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'),
    ).toBe(true);
  });
});
