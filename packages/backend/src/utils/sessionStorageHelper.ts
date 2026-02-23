import { decryptText, encryptText } from './cryptoUtils';

export const SESSION_PASSWORD_KEY = '8C7822A5D65E99D67FDE93E344AF9'; //consider chrome-app-id
const PASSWORD_TTL = 60 * 60 * 1000;

export async function setSessionPassword(pwd: string): Promise<void> {
  const encrypted = await encryptText(pwd);
  const data = { value: encrypted, expiry: Date.now() + PASSWORD_TTL };
  await chrome.storage.session.set({ [SESSION_PASSWORD_KEY]: data });
}

export async function getSessionPassword(): Promise<string | null> {
  const result = await chrome.storage.session.get([SESSION_PASSWORD_KEY]);
  const data = result[SESSION_PASSWORD_KEY];
  if (!data) return null;
  if (Date.now() > data.expiry) {
    await chrome.storage.session.remove([SESSION_PASSWORD_KEY]);
    return null;
  }

  try {
    return await decryptText(data.value);
  } catch (error) {
    console.error('Error decrypting session password:', error);
    return null;
  }
}

export async function deleteSessionPassword(): Promise<void> {
  await chrome.storage.session.remove([SESSION_PASSWORD_KEY]);
}
