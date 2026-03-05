/**
 * Unified Encryption Module — Web Crypto API
 *
 * Provides two encryption modes:
 *
 * 1. **Password-based** (for wallet vault):
 *    - PBKDF2 key derivation (600 000 iterations, SHA-256, random salt)
 *    - AES-256-GCM authenticated encryption (random IV)
 *    - Format: base64( salt[16] ‖ iv[12] ‖ ciphertext+tag )
 *
 * 2. **Key-based** (for session storage):
 *    - AES-256-GCM with a randomly generated key
 *    - Format: base64( iv[12] ‖ ciphertext+tag )
 */

// ──────────────────────────────────────────────
//  Constants
// ──────────────────────────────────────────────
const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

// ──────────────────────────────────────────────
//  Internal helpers
// ──────────────────────────────────────────────

function toBase64(buf: Uint8Array): string {
  return btoa(String.fromCharCode(...buf));
}

function fromBase64(str: string): Uint8Array {
  return Uint8Array.from(atob(str), c => c.charCodeAt(0));
}

/**
 * Derive a 256-bit AES-GCM key from a password and salt using PBKDF2.
 */
async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password).buffer as ArrayBuffer,
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt.buffer as ArrayBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// ──────────────────────────────────────────────
//  Password-based encrypt / decrypt (vault)
// ──────────────────────────────────────────────

/**
 * Encrypt plaintext with a user-supplied password.
 *
 * Uses PBKDF2 for key derivation and AES-256-GCM for authenticated encryption.
 * Returns a base64 string containing salt ‖ iv ‖ ciphertext+authTag.
 */
export async function encrypt(plaintext: string, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(password, salt);

  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);

  // Combine: salt(16) + iv(12) + ciphertext+tag
  const combined = new Uint8Array(salt.byteLength + iv.byteLength + ciphertext.byteLength);
  combined.set(salt, 0);
  combined.set(iv, salt.byteLength);
  combined.set(new Uint8Array(ciphertext), salt.byteLength + iv.byteLength);

  return toBase64(combined);
}

/**
 * Decrypt a ciphertext string produced by `encrypt()` using the same password.
 *
 * Throws on wrong password or tampered data (AES-GCM authentication failure).
 */
export async function decrypt(ciphertext: string, password: string): Promise<string> {
  const combined = fromBase64(ciphertext);

  const salt = combined.slice(0, SALT_BYTES);
  const iv = combined.slice(SALT_BYTES, SALT_BYTES + IV_BYTES);
  const data = combined.slice(SALT_BYTES + IV_BYTES);

  const key = await deriveKey(password, salt);
  const decryptedBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);

  return new TextDecoder().decode(decryptedBuffer);
}

// ──────────────────────────────────────────────
//  Key-based encrypt / decrypt (session storage)
// ──────────────────────────────────────────────

/**
 * Generate a random AES-256-GCM key and return it as a base64-encoded raw key.
 */
async function generateSessionKey(): Promise<string> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const raw = await crypto.subtle.exportKey('raw', key);
  return toBase64(new Uint8Array(raw));
}

/**
 * Import a raw base64-encoded key for AES-GCM.
 */
async function importSessionKey(rawKeyBase64: string): Promise<CryptoKey> {
  const raw = fromBase64(rawKeyBase64);
  return crypto.subtle.importKey('raw', raw.buffer as ArrayBuffer, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

const SESSION_CRYPTO_KEY_STORAGE = '__chui_session_crypto_key';

/**
 * Get or create the per-session encryption key stored in chrome.storage.session.
 */
async function getOrCreateSessionKey(): Promise<CryptoKey> {
  const result = await chrome.storage.session.get([SESSION_CRYPTO_KEY_STORAGE]);
  let rawKey = result[SESSION_CRYPTO_KEY_STORAGE] as string | undefined;

  if (!rawKey) {
    rawKey = await generateSessionKey();
    await chrome.storage.session.set({ [SESSION_CRYPTO_KEY_STORAGE]: rawKey });
  }

  return importSessionKey(rawKey);
}

/**
 * Encrypt plaintext with the per-session random key (AES-256-GCM).
 * Returns base64( iv[12] ‖ ciphertext+tag ).
 */
export async function encryptText(plaintext: string): Promise<string> {
  const key = await getOrCreateSessionKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);

  const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.byteLength);

  return toBase64(combined);
}

/**
 * Decrypt ciphertext produced by `encryptText()` using the per-session random key.
 */
export async function decryptText(encryptedText: string): Promise<string> {
  const key = await getOrCreateSessionKey();
  const combined = fromBase64(encryptedText);

  const iv = combined.slice(0, IV_BYTES);
  const data = combined.slice(IV_BYTES);

  const decryptedBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return new TextDecoder().decode(decryptedBuffer);
}

export default { encrypt, decrypt };
