import type { OnboardingDraft } from '../types/onboarding';
import { ONBOARDING_DRAFT_KEY } from '../constants/constants';
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

export async function setOnboardingDraft(draft: OnboardingDraft): Promise<void> {
  const encryptedPassword = await encryptText(draft.password);
  const encryptedConfirm = await encryptText(draft.confirmPassword);
  await chrome.storage.session.set({
    [ONBOARDING_DRAFT_KEY]: {
      password: encryptedPassword,
      confirmPassword: encryptedConfirm,
      termsAccepted: draft.termsAccepted,
    },
  });
}

export async function getOnboardingDraft(): Promise<OnboardingDraft | null> {
  const result = await chrome.storage.session.get([ONBOARDING_DRAFT_KEY]);
  const data = result[ONBOARDING_DRAFT_KEY];
  if (!data) return null;

  try {
    const password = await decryptText(data.password);
    const confirmPassword = await decryptText(data.confirmPassword);
    return { password, confirmPassword, termsAccepted: data.termsAccepted };
  } catch (error) {
    console.error('Error decrypting onboarding draft:', error);
    return null;
  }
}

export async function deleteOnboardingDraft(): Promise<void> {
  await chrome.storage.session.remove([ONBOARDING_DRAFT_KEY]);
}
