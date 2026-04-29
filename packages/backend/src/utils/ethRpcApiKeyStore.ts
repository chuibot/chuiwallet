const KEY = 'ethRpcApiKey';

export async function getEthRpcApiKey(): Promise<string | undefined> {
  const result = await chrome.storage.session.get([KEY]);
  const value = result[KEY];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export async function setEthRpcApiKey(value: string): Promise<void> {
  if (value.length === 0) {
    await chrome.storage.session.remove([KEY]);
    return;
  }
  await chrome.storage.session.set({ [KEY]: value });
}

export async function deleteEthRpcApiKey(): Promise<void> {
  await chrome.storage.session.remove([KEY]);
}
