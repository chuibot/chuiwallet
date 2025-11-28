import { ERROR_MESSAGES, EXTENSION_ERRORS } from '@src/constants';
import browser from 'webextension-polyfill';

type RouterResponse = { status: 'ok'; data: unknown } | { status: 'error'; error: { code: string; message: string } };

export async function sendMessage<T>(action: string, params?: unknown): Promise<T> {
  try {
    const response: RouterResponse = await browser.runtime.sendMessage({ action, params });
    if (response.status === 'error') {
      throw new Error(response.error.message);
    }
    return response.data as T;
  } catch (error) {
    if (error instanceof Error) {
      // Common extension errors when connection is lost
      if (
        error.message.includes(EXTENSION_ERRORS.CONTEXT_INVALIDATED) ||
        error.message.includes(EXTENSION_ERRORS.CONNECTION_ERROR) ||
        error.message.includes(EXTENSION_ERRORS.PORT_CLOSED) ||
        error.message.includes(EXTENSION_ERRORS.NO_RECEIVER)
      ) {
        throw new Error(ERROR_MESSAGES.CONNECTION_LOST);
      }
    }
    throw error;
  }
}
