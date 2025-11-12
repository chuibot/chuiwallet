import * as bitcoin from 'bitcoinjs-lib';
import { Network } from '@src/types';

/**
 * Simple password strength checker:
 * - length >= 8 => +1
 * - has uppercase => +1
 * - has digit => +1
 * - has special character => +1
 *
 * Score 0-1 => weak
 * Score 2 => medium
 * Score >=3 => strong
 */
export function getPasswordStrength(password: string): 'weak' | 'medium' | 'strong' {
  let score = 0;
  if (password.length >= 8) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  if (score >= 3) return 'strong';
  if (score === 2) return 'medium';
  return 'weak';
}

export function pickRandomPositions(n: number, total: number): number[] {
  const positions: number[] = [];
  while (positions.length < n) {
    const pos = Math.floor(Math.random() * total) + 1;
    if (!positions.includes(pos)) {
      positions.push(pos);
    }
  }
  return positions.sort((a, b) => a - b);
}

export function formatNumber(value: number, digits: number = 2): string {
  const fixed = value.toFixed(digits);
  let [integer, fraction] = fixed.split('.');
  integer = parseInt(integer, 10).toLocaleString();
  fraction = fraction.replace(/0+$/, '');
  fraction = fraction.length > 0 ? '.' + fraction : '';
  return integer === '0' ? '0' + fraction : integer + fraction;
}

/**
 * Helper to format timestamp to something like "10:30 AM"
 */
export function timestampToTime(timestamp: number) {
  const date = new Date(timestamp * 1000);

  let hours = date.getHours();
  const minutes = date.getMinutes();

  const period = hours >= 12 ? 'PM' : 'AM';

  hours = hours % 12;
  hours = hours ? hours : 12;

  const formattedHours = hours < 10 ? '0' + hours : hours;
  const formattedMinutes = minutes < 10 ? '0' + minutes : minutes;

  return `${formattedHours}:${formattedMinutes} ${period}`;
}

export function capitalizeFirstLetter(value: string) {
  return String(value).charAt(0).toUpperCase() + String(value).slice(1);
}

export function formatTimestamp(timestamp: number) {
  const date = new Date(timestamp * 1000);

  const day = ('0' + date.getDate()).slice(-2);
  const month = ('0' + (date.getMonth() + 1)).slice(-2);
  const year = date.getFullYear().toString().slice(-2);

  let hours = date.getHours();
  const minutes = ('0' + date.getMinutes()).slice(-2);
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;

  return `${day}/${month}/${year} at ${hours}:${minutes} ${ampm}`;
}

/**
 * Return an icon path and label text based on status
 */
export function getStatusMeta(status: string) {
  return {
    icon: `popup/${status}_icon.svg`,
    label: capitalizeFirstLetter(status),
  };
}

export function truncateMiddleTxn(address: string, front = 10, back = 6) {
  if (!address) return '';

  if (address.length <= front + back) return address;

  return `${address.slice(0, front)}...${address.slice(-back)}`;
}

export function truncateLastTxn(address: string, front = 10) {
  if (!address) return '';

  if (address.length <= front) return address;

  return `${address.slice(0, front)}...`;
}

export function isValidBTCAddress(addr: string, expected: Network): boolean {
  const net = expected === Network.Mainnet ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
  try {
    bitcoin.address.toOutputScript(addr, net); // throws if bad format or wrong network
    return true;
  } catch {
    return false;
  }
}

export async function getBtcToUsdRate(): Promise<number> {
  const response = await fetch('https://www.blockonomics.co/api/price?currency=USD');
  if (!response.ok) {
    throw new Error('Failed to fetch BTC to USD rate');
  }
  const data = await response.json();
  return data.price;
}
