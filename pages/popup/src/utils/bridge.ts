import browser from 'webextension-polyfill';

type RouterResponse = { status: 'ok'; data: unknown } | { status: 'error'; error: { code: string; message: string } };

export async function sendMessage<T>(action: string, params?: unknown): Promise<T> {
  const response: RouterResponse = await browser.runtime.sendMessage({ action, params });
  if (response.status === 'error') throw new Error(response.error.message);
  return response.data as T;
}
