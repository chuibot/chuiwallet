import type * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Route, Routes, StaticRouter } from 'react-router-dom';
import { Network } from '@src/types';
import { SendStatus } from '@src/pages/send/SendStatus';
import { TransactionDetail, type TransactionDetailStates } from '@src/pages/dashboard/TransactionDetail';

const TX_HASH = '0x2c8e1a5f0f8d3b7a9e6c4d2b1a0f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a29';

// Another window has switched the EVM network to Sepolia since the transaction was sent or listed on mainnet.
const mockPreferences = {
  activeNetwork: Network.Mainnet,
  activeEvmNetwork: Network.Testnet,
  fiatCurrency: 'USD',
};

jest.mock('@src/context/WalletContext', () => ({
  useWalletContext: () => ({ preferences: mockPreferences }),
}));

beforeAll(() => {
  (globalThis as unknown as { chrome: unknown }).chrome = { runtime: { getURL: (path: string) => path } };
});

function render(path: string, routePattern: string, element: React.ReactElement, state: unknown): string {
  return renderToStaticMarkup(
    <StaticRouter location={{ pathname: path, state }}>
      <Routes>
        <Route path={routePattern} element={element} />
      </Routes>
    </StaticRouter>,
  );
}

describe('explorer links keep the network the transaction belongs to', () => {
  it.each(['eth', 'usdt'])('the %s send status screen links the mainnet explorer', currency => {
    const html = render(`/send/${currency}/status`, '/send/:currency/status', <SendStatus />, {
      status: 'success',
      transactionHash: TX_HASH,
      network: Network.Mainnet,
    });

    expect(html).toContain(`https://eth.blockscout.com/tx/${TX_HASH}`);
    expect(html).not.toContain('eth-sepolia');
  });

  it.each(['eth', 'usdt'])('the %s transaction detail screen links the mainnet explorer', currency => {
    const state: TransactionDetailStates = {
      type: 'SEND',
      status: 'CONFIRMED',
      amountBtc: 1,
      feeBtc: 0.001,
      timestamp: 1_790_000_000_000,
      confirmations: 12,
      transactionHash: TX_HASH,
      sender: '0x1111111111111111111111111111111111111111',
      receiver: '0x2222222222222222222222222222222222222222',
      network: Network.Mainnet,
    };

    const html = render(
      `/dashboard/${currency}/activity/${TX_HASH}/detail`,
      '/dashboard/:currency/activity/:txnHash/detail',
      <TransactionDetail />,
      state,
    );

    expect(html).toContain(`https://eth.blockscout.com/tx/${TX_HASH}`);
    expect(html).not.toContain('eth-sepolia');
  });
});
