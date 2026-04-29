import browser from 'webextension-polyfill';

type RouterResponse =
  | { status: 'ok'; data: unknown }
  | { status: 'error'; error: { code: string; message: string; data?: unknown } };

export class BridgeError extends Error {
  readonly code: string;
  readonly data?: unknown;

  constructor(code: string, message: string, data?: unknown) {
    super(message);
    this.code = code;
    this.data = data;
    this.name = 'BridgeError';
  }
}

export async function sendMessage<T>(action: string, params?: unknown): Promise<T> {
  const type = 'APP_ACTION';
  const response: RouterResponse = await browser.runtime.sendMessage({ type, action, params });
  if (response.status === 'error') {
    throw new BridgeError(response.error.code, response.error.message, response.error.data);
  }
  return response.data as T;
}
