import Wallet from '@extension/backend/src/modules/wallet';
import { getSessionPassword } from '@extension/backend/src/utils/sessionStorageHelper';
import { Button } from '@src/components/Button';
import Header from '@src/components/Header';
import { useWalletContext } from '@src/context/WalletContext';
import type { StoredAccount, Currencies } from '@src/types';
import { currencyMapping } from '@src/types';
import { formatNumber } from '@src/utils';
import { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

interface SendPreviewStates {
  destinationAddress: string;
  amountBtc: number;
  amountUsd: number;
  feeBtc: number;
  feeUsd: number;
  sats: number;
}

export function SendPreview() {
  const navigate = useNavigate();
  const location = useLocation();
  const { refreshAllBalances, refreshTxHistory, selectedAccountIndex, wallet } = useWalletContext();
  const { currency } = useParams<{ currency: Currencies }>();
  const states = location.state as SendPreviewStates;

  const [confirmLoading, setConfirmLoading] = useState<boolean>(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [error, setError] = useState('');

  const handleConfirm = async () => {
    setConfirmLoading(true);

    const storedPwd = await getSessionPassword();
    if (storedPwd) {
      chrome.storage.local.get(['storedAccount'], res => {
        const storedAccount: StoredAccount | undefined = res.storedAccount;
        if (storedAccount) {
          const restoredMnemonic = Wallet.getDecryptedMnemonic(storedAccount.encryptedMnemonic, storedPwd);
          if (!restoredMnemonic) {
            console.error('Failed to recover seed with stored password.');
          }

          const walletData = {
            password: storedPwd!,
            mnemonic: restoredMnemonic!,
            network: storedAccount.network,
            addressType: 'bech32',
            accountIndex: storedAccount.selectedAccountIndex,
          };

          chrome.runtime.sendMessage(
            {
              action: 'signAndSendTransaction',
              walletData,
              to: states.destinationAddress,
              amount: Math.round(states.amountBtc * 1e8),
              feeRates: Math.round(states.feeBtc * 1e8),
            },
            response => {
              if (response?.success) {
                const transactionHash = response.txid;
                console.log(transactionHash);
                if (transactionHash) {
                  if (wallet) {
                    refreshAllBalances();
                    refreshTxHistory(selectedAccountIndex);
                  }

                  navigate(`/send/${currency}/status`, {
                    state: {
                      status: 'success',
                      transactionHash,
                    },
                  });
                } else {
                  setError('Failed to broadcast transaction');
                }
              } else {
                setError(response.error);
              }

              setConfirmLoading(false);
            },
          );
        }
      });
    } else {
      setError('Wallet is null');
      setConfirmLoading(false);
    }
  };

  return (
    <div className="relative flex flex-col items-center text-white bg-dark h-full px-4 pt-12 pb-[19px]">
      <Header title="Confirm Transaction" />

      <div className="flex flex-col mt-14 w-full text-lg max-w-[600px] mx-auto">
        <div className="flex flex-col w-full leading-none">
          <div className="font-medium text-white">Asset Sent</div>
          <div className="flex gap-2 items-center mt-2 w-full text-foreground-79">
            <img
              loading="lazy"
              src={chrome.runtime.getURL(`popup/${currency}_coin.svg`)}
              className="object-contain shrink-0 self-stretch my-auto w-8 aspect-square"
              alt="Asset"
            />
            <div className="self-stretch my-auto">
              {currency ? currencyMapping[currency] : 'Unknown'} ({currency?.toUpperCase()})
            </div>
          </div>
        </div>
        <div className="flex flex-col mt-6 w-full flex-wrap">
          <div className="font-medium leading-none text-white">Destination address</div>
          <div className="mt-2 leading-6 text-foreground-79 text-wrap break-all">{states.destinationAddress}</div>
        </div>
        <div className="flex flex-col mt-6 w-full leading-none text-foreground-79">
          <div className="font-medium text-white">Amount to send</div>
          <div className="mt-2">{formatNumber(states.amountBtc, 8)} BTC</div>
          <div className="mt-2">{formatNumber(states.amountUsd)} USD</div>
        </div>
        <div className="flex flex-col mt-6 w-full leading-none text-foreground-79">
          <div className="font-medium text-white">Fee</div>
          <div className="mt-2">
            {formatNumber(states.feeBtc, 8)} BTC <span className="text-sm">({formatNumber(states.sats)} sat/vB)</span>
          </div>
          <div className="mt-2">{formatNumber(states.feeUsd)} USD</div>
        </div>
      </div>

      <Button
        className="flex justify-center gap-2 absolute bottom-[19px] max-w-[600px] mx-auto"
        onClick={handleConfirm}>
        {confirmLoading && (
          <div role="status">
            <svg
              aria-hidden="true"
              className="inline w-5 h-5 text-primary-yellow animate-spin dark:text-gray-600 fill-dark"
              viewBox="0 0 100 101"
              fill="none"
              xmlns="http://www.w3.org/2000/svg">
              <path
                d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z"
                fill="currentColor"
              />
              <path
                d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z"
                fill="currentFill"
              />
            </svg>
          </div>
        )}
        Confirm & Send
      </Button>
    </div>
  );
}
