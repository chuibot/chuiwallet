import { Network } from '@src/types';
import { isValidAddress } from '@src/utils';

const ETH_ADDRESS = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94';

describe('isValidAddress', () => {
  describe('btc', () => {
    it.each([
      ['P2WPKH', 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'],
      ['P2SH', '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy'],
      ['P2PKH', '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'],
    ])('accepts a mainnet %s address on mainnet only', (_type, address) => {
      expect(isValidAddress(address, 'btc', Network.Mainnet)).toBe(true);
      expect(isValidAddress(address, 'btc', Network.Testnet)).toBe(false);
    });

    it.each([
      ['P2WPKH', 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx'],
      ['P2PKH', 'mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn'],
    ])('accepts a testnet %s address on testnet only', (_type, address) => {
      expect(isValidAddress(address, 'btc', Network.Testnet)).toBe(true);
      expect(isValidAddress(address, 'btc', Network.Mainnet)).toBe(false);
    });

    it('rejects a mistyped address and an Ethereum address', () => {
      expect(isValidAddress('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyv', 'btc', Network.Mainnet)).toBe(false);
      expect(isValidAddress(ETH_ADDRESS, 'btc', Network.Mainnet)).toBe(false);
    });
  });

  describe('eth and usdt', () => {
    it('accepts a 0x address with 40 hex digits on either network', () => {
      for (const currency of ['eth', 'usdt']) {
        expect(isValidAddress(ETH_ADDRESS, currency, Network.Mainnet)).toBe(true);
        expect(isValidAddress(ETH_ADDRESS, currency, Network.Testnet)).toBe(true);
        expect(isValidAddress(ETH_ADDRESS.toLowerCase(), currency, Network.Mainnet)).toBe(true);
      }
    });

    it.each([
      ['without the 0x prefix', ETH_ADDRESS.slice(2)],
      ['one digit short', ETH_ADDRESS.slice(0, -1)],
      ['one digit long', `${ETH_ADDRESS}0`],
      ['with a non-hex digit', `${ETH_ADDRESS.slice(0, -1)}g`],
      ['with surrounding spaces', ` ${ETH_ADDRESS} `],
    ])('rejects an address %s', (_case, address) => {
      expect(isValidAddress(address, 'eth', Network.Mainnet)).toBe(false);
    });

    it('rejects a Bitcoin address', () => {
      expect(isValidAddress('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', 'eth', Network.Mainnet)).toBe(false);
    });
  });

  it('rejects every address for a currency the send flow does not handle', () => {
    expect(isValidAddress('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', 'bch', Network.Mainnet)).toBe(false);
    expect(isValidAddress(ETH_ADDRESS, 'doge', Network.Mainnet)).toBe(false);
  });
});
