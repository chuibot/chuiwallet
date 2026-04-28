import { resetChromeStorage } from '../helpers/chromeMock';
import { decrypt, decryptText, encrypt, encryptText } from '../../src/utils/encryption';

describe('password-based encrypt/decrypt', () => {
  beforeEach(() => resetChromeStorage());

  it('round-trips plaintext with the same password', async () => {
    const plaintext = 'twelve word seed phrase here';
    const ct = await encrypt(plaintext, 'correct horse battery staple');
    const recovered = await decrypt(ct, 'correct horse battery staple');
    expect(recovered).toBe(plaintext);
  });

  it('produces a base64 string with non-trivial length', async () => {
    const ct = await encrypt('hello', 'pw');
    expect(typeof ct).toBe('string');
    expect(ct).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(ct.length).toBeGreaterThan(20);
  });

  it('produces different ciphertexts on each call (random salt + iv)', async () => {
    const a = await encrypt('hello', 'pw');
    const b = await encrypt('hello', 'pw');
    expect(a).not.toBe(b);
  });

  it('throws when decrypted with the wrong password', async () => {
    const ct = await encrypt('s3cret', 'right');
    await expect(decrypt(ct, 'wrong')).rejects.toBeDefined();
  });

  it('throws when ciphertext is tampered (auth tag check)', async () => {
    const ct = await encrypt('s3cret', 'pw');
    const tampered = ct.slice(0, -2) + (ct.slice(-2) === 'AA' ? 'BB' : 'AA');
    await expect(decrypt(tampered, 'pw')).rejects.toBeDefined();
  });

  it('handles unicode plaintext', async () => {
    const plaintext = '日本語 — emoji 🔐 — and accents çñ';
    const ct = await encrypt(plaintext, 'pw');
    expect(await decrypt(ct, 'pw')).toBe(plaintext);
  });

  it('handles long plaintexts (64 KB)', async () => {
    const plaintext = 'A'.repeat(64 * 1024);
    const ct = await encrypt(plaintext, 'pw');
    expect(await decrypt(ct, 'pw')).toBe(plaintext);
  });

  it('handles empty plaintext', async () => {
    const ct = await encrypt('', 'pw');
    expect(await decrypt(ct, 'pw')).toBe('');
  });
});

describe('session key encrypt/decrypt (encryptText / decryptText)', () => {
  beforeEach(() => resetChromeStorage());

  it('round-trips text using the per-session key', async () => {
    const ct = await encryptText('hello session');
    expect(await decryptText(ct)).toBe('hello session');
  });

  it('reuses the same key on subsequent calls', async () => {
    const a = await encryptText('one');
    const b = await encryptText('two');
    expect(await decryptText(a)).toBe('one');
    expect(await decryptText(b)).toBe('two');
  });

  it('persists the session key in chrome.storage.session', async () => {
    await encryptText('init');
    const stored = await chrome.storage.session.get('__chui_session_crypto_key');
    expect(typeof stored.__chui_session_crypto_key).toBe('string');
    expect((stored.__chui_session_crypto_key as string).length).toBeGreaterThan(20);
  });

  it('produces ciphertexts that differ across encryptText calls (random IV)', async () => {
    const a = await encryptText('same');
    const b = await encryptText('same');
    expect(a).not.toBe(b);
    expect(await decryptText(a)).toBe('same');
    expect(await decryptText(b)).toBe('same');
  });

  it('cannot decrypt across resets (key is regenerated)', async () => {
    const ct = await encryptText('one');
    resetChromeStorage();
    await expect(decryptText(ct)).rejects.toBeDefined();
  });
});
