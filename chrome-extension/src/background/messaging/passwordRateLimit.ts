const STATE_KEY = 'wallet.verifyPasswordRateLimit';
const SHORT_LOCKOUT_MS = 10 * 1000;
const LONG_LOCKOUT_MS = 60 * 60 * 1000;
const SHORT_THRESHOLD = 3;
const LONG_THRESHOLD = 10;

type State = { count: number; lockedUntil: number };

async function readState(): Promise<State> {
  const result = await chrome.storage.session.get([STATE_KEY]);
  const value = result[STATE_KEY] as State | undefined;
  return value ?? { count: 0, lockedUntil: 0 };
}

async function writeState(state: State): Promise<void> {
  await chrome.storage.session.set({ [STATE_KEY]: state });
}

export async function getLockoutRemainingMs(): Promise<number> {
  const { lockedUntil } = await readState();
  return Math.max(0, lockedUntil - Date.now());
}

export async function recordPasswordFailure(): Promise<void> {
  const state = await readState();
  state.count += 1;
  if (state.count >= LONG_THRESHOLD) {
    state.lockedUntil = Date.now() + LONG_LOCKOUT_MS;
  } else if (state.count >= SHORT_THRESHOLD) {
    state.lockedUntil = Date.now() + SHORT_LOCKOUT_MS;
  }
  await writeState(state);
}

export async function recordPasswordSuccess(): Promise<void> {
  await chrome.storage.session.remove([STATE_KEY]);
}
