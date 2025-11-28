export const ERROR_MESSAGES = {
  INCORRECT_PASSWORD: 'Incorrect password.',
  SOMETHING_WENT_WRONG: 'Something went wrong. Please try again.',
  PLEASE_ENTER_PASSWORD: 'Please enter your password.',
  INVALID_NETWORK_SELECTED: 'Invalid network selected.',
  NETWORK_SWITCH_FAILED: 'Failed to switch network.',
};

export const BANNER_TYPES = {
  SUCCESS: 'success',
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info',
} as const;

export type BannerType = (typeof BANNER_TYPES)[keyof typeof BANNER_TYPES];

export const BANNER_DURATIONS = {
  SUCCESS: 3000,
  INFO: 5000,
  WARNING: 5000,
  ERROR: 0, // No auto-dismiss for errors
  DEFAULT: 4000,
} as const;
