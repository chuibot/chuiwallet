import browser from 'webextension-polyfill';

type RouterResponse = { status: 'ok'; data: unknown } | { status: 'error'; error: { code: string; message: string } };

export async function sendMessage<T>(action: string, params?: unknown): Promise<T> {
  const type = 'APP_ACTION';
  const response: RouterResponse = await browser.runtime.sendMessage({ type, action, params });
  if (response.status === 'error') throw new Error(response.error.message);
  return response.data as T;
}
