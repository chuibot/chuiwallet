import { installChromeMock } from './helpers/chromeMock';

installChromeMock();

const isDebug = !!process.env.DEBUG_TESTS;
if (!isDebug) {
  for (const method of ['log', 'warn', 'error', 'debug', 'info'] as const) {
    const original = console[method];
    console[method] = (...args: unknown[]) => {
      if (process.env.DEBUG_TESTS) original.call(console, ...args);
    };
  }
}
