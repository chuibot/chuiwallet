import { formatNumber } from '@src/utils';

export function formatFeeAmount(value: number, symbol: string): string {
  if (!Number.isFinite(value) || value === 0) {
    return `0 ${symbol}`;
  }

  const digits = symbol === 'BTC' ? 8 : value < 0.000001 ? 8 : 6;
  return `${formatNumber(value, digits)} ${symbol}`;
}

export function formatFiatValue(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) {
    return 'USD unavailable';
  }

  if (value > 0 && value < 0.01) {
    return '<0.01 USD';
  }

  return `${formatNumber(value)} USD`;
}

export function formatFeeRate(value?: number, unit?: string): string | null {
  if (value === undefined || !unit || !Number.isFinite(value)) {
    return null;
  }

  if (unit !== 'gwei') {
    return `${formatNumber(value, 0)} ${unit}`;
  }

  const digits = value >= 1 ? 2 : value >= 0.01 ? 4 : 6;
  const formatted = formatNumber(value, digits);

  if (formatted === '0' && value > 0) {
    return `<${formatNumber(1 / Math.pow(10, digits), digits)} ${unit}`;
  }

  return `${formatted} ${unit}`;
}
