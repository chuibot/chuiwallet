import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { sendMessage } from '@src/utils/bridge';
//Todo: Consider decouple type from backend
import type { BalanceData, Preferences } from '@src/types';
import type { Account } from '@extension/backend/src/types/wallet';
import type { TxEntry } from '@extension/backend/src/types/cache';
import { defaultPreferences } from '@extension/backend/dist/preferenceManager';
import { useChuiEvents } from '@src/hooks/useChuiEvents';

interface WalletContextType {
  onboarded: boolean;
  unlocked: boolean;
  setOnboarded: (onboarded: boolean) => void;
  setUnlocked: (unlocked: boolean) => void;
  preferences: Preferences;
  setPreferences: (preferences: Preferences) => void;
  accounts: Account[];
  activeAccount: Account | undefined;
  balance: BalanceData | undefined;
  refreshBalance: () => void;
  transactions: TxEntry[];
  refreshTransactions: () => void;
  getReceivingAddress: () => Promise<string>;
  init: () => void;
  logout: () => void;
  lock: () => void;
  // network: 'mainnet' | 'testnet';
  // totalAccounts: number;
  // selectedFiatCurrency: 'USD' | 'BTC';
  // isRestored: boolean;

  // setTotalAccounts: (index: number) => void;
  // setSelectedFiatCurrency: (currency: 'USD' | 'BTC') => void;
  // switchAccount: (index: number) => void;
  // nextAccount: () => void;
  // addAccount: () => void;
  // createWallet: (seed: string, password: string, network?: 'mainnet' | 'testnet', addressType?: ScriptType) => void;
  // restoreWallet: (seed: string, password: string, network?: 'mainnet' | 'testnet', addressType?: ScriptType) => void;
  // unlockWallet: (password: string) => void;
  // clearWallet: () => void;
  // updateNetwork: (newNetwork: 'mainnet' | 'testnet') => void;
  // cachedBalances: { [accountIndex: number]: BalanceData | null };

  // refreshAllBalances: () => void;
  // cachedTxHistories: { [accountIndex: number]: TransactionActivity[] | null };
  // refreshTxHistory: (accountIndex: number) => void;
  // logout: () => void;
  // gapLimit: number;
  // getXpub: () => Promise<string>;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export const WalletProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [onboarded, setOnboarded] = useState<boolean>(false);
  const [unlocked, setUnlocked] = useState<boolean>(false);
  const [preferences, setPreferences] = useState<Preferences>(defaultPreferences);
  const [accounts, _setAccounts] = useState<Account[]>([]);
  const [balance, _setBalance] = useState<BalanceData>();
  const [transactions, _setTransactions] = useState<TxEntry[]>([]);
  const activeAccount = useMemo<Account | undefined>(() => {
    const i = preferences?.activeAccountIndex ?? 0;
    return accounts[i];
  }, [accounts, preferences?.activeAccountIndex]);

  // const [selectedFiatCurrency, _setSelectedFiatCurrency] = useState<'USD' | 'BTC'>('USD');
  // const [network, _setNetwork] = useState<'mainnet' | 'testnet'>('mainnet');
  // const [pendingNewAccountIndex, setPendingNewAccountIndex] = useState<number | null>(null);
  // const [isRestored, setIsRestored] = useState(false);
  // const [cachedBalances, setCachedBalances] = useState<{
  //   [accountIndex: number]: BalanceData | null;
  // }>({});
  // const [lastBalanceFetchMap, setLastBalanceFetchMap] = useState<{
  //   [accountIndex: number]: number;
  // }>({});
  // const [lastTxFetchMap, setLastTxFetchMap] = useState<{ [accountIndex: number]: number }>({});

  // const setWallet = (newWallet: Wallet, newPassword: string) => {
  //   setWalletState(newWallet);
  //   setPassword(newPassword);
  //   setSessionPassword(newPassword);
  // };

  // const clearWallet = async () => {
  //   setWalletState(null);
  //   setPassword('');
  //   await deleteSessionPassword();
  // };

  const init = async () => {
    const isRestorable = await sendMessage('wallet.restore');
    if (isRestorable) {
      setUnlocked(true);
      const preferences: Preferences = await sendMessage('preferences.get');
      const accounts: [] = await sendMessage('accounts.get');
      setPreferences(preferences);
      _setAccounts(accounts);
    }
  };

  useChuiEvents({
    onSnapshot: d => console.log(d),
    onConnection: e => console.log('connection', e),
    onBalance: e => console.log(e),
    onTx: e => console.log(e),
  });

  // Hydrate settings (onboarded, preferences, accounts)
  useEffect(() => {
    (async () => {
      try {
        const isExist = await sendMessage('wallet.exist');
        if (isExist) {
          setOnboarded(true);
          await init();
        }
      } catch (e) {
        console.error(e);
      }
    })();
  }, []);

  // Get wallet balance
  useEffect(() => {
    (async () => {
      const balance: BalanceData = await sendMessage('wallet.getBalance');
      _setBalance(balance);
    })();
  }, [
    preferences.activeNetwork,
    preferences.activeAccountIndex,
    preferences.gapLimitReceive,
    preferences.gapLimitChange,
  ]);

  const refreshBalance = () => {
    (async () => {
      const balance: BalanceData = await sendMessage('wallet.getBalance');
      _setBalance(balance);
    })();
  };

  const refreshTransactions = () => {
    (async () => {
      const transactions: [] = await sendMessage('transactions.get');
      _setTransactions(transactions);
    })();
  };

  const getReceivingAddress = (): Promise<string> => {
    return (async () => {
      return await sendMessage('wallet.getReceivingAddress');
    })();
  };

  const lock = () => {
    return (async () => {
      await sendMessage('wallet.lock');
      setUnlocked(false);
    })();
  };

  const logout = () => {
    return (async () => {
      await sendMessage('wallet.logout');
      setOnboarded(false);
      setUnlocked(true);
    })();
  };

  // const refreshBalance = useCallback(
  //   (accountIndex: number) => {
  //     const now = Date.now();
  //     if (cachedBalances[accountIndex] && now - (lastBalanceFetchMap[accountIndex] || 0) < 300000) {
  //       return;
  //     }
  //     if (wallet) {
  //       const walletAddress = wallet.getAddress('bech32', accountIndex);
  //       if (walletAddress) {
  //         chrome.runtime.sendMessage({ action: 'getBalance', walletAddress }, response => {
  //           if (response?.success && response.balance) {
  //             setCachedBalances(prev => ({
  //               ...prev,
  //               [accountIndex]: response.balance,
  //             }));
  //             setLastBalanceFetchMap(prev => ({
  //               ...prev,
  //               [accountIndex]: now,
  //             }));
  //           }
  //         });
  //       }
  //     }
  //   },
  //   [cachedBalances, lastBalanceFetchMap, wallet],
  // );

  // Security Watchdog
  // useEffect(() => {
  //   const interval = setInterval(() => {
  //     const currentPwd = getSessionPassword();
  //     if (!currentPwd) {
  //       clearWallet();
  //     }
  //   }, 60 * 1000);
  //   return () => clearInterval(interval);
  // }, []);

  // const switchAccount = useCallback(
  //   (index: number) => {
  //     if (!wallet) return;
  //
  //     if (index < 0 || index >= totalAccounts) {
  //       console.error('Invalid account index');
  //       return;
  //     }
  //
  //     wallet.setAccount(index);
  //     setSelectedAccountIndex(index);
  //
  //     chrome.storage.local.get(['storedAccount'], res => {
  //       const storedAccount: StoredAccount | undefined = res.storedAccount;
  //       if (storedAccount) {
  //         storedAccount.selectedAccountIndex = index;
  //         chrome.storage.local.set({ storedAccount }, () => {
  //         });
  //       }
  //     });
  //   },
  //   [totalAccounts, wallet],
  // );

  // const nextAccount = () => {
  //   if (!wallet || totalAccounts === 0) return;
  //
  //   const nextIndex = (selectedAccountIndex + 1) % totalAccounts;
  //   switchAccount(nextIndex);
  // };

  // const addAccount = () => {
  //   if (!password || !wallet) {
  //     console.error('Cannot add account without a wallet and password');
  //     return;
  //   }
  //
  //   chrome.storage.local.get(['storedAccount'], res => {
  //     const storedAccount: StoredAccount | undefined = res.storedAccount;
  //     if (storedAccount) {
  //       const newIndex = totalAccounts;
  //       const newTotal = newIndex + 1;
  //
  //       const newStoredAccount: StoredAccount = {
  //         ...storedAccount,
  //         selectedAccountIndex: newIndex,
  //         totalAccounts: newTotal,
  //       };
  //
  //       setTotalAccounts(newTotal);
  //       setPendingNewAccountIndex(newIndex);
  //
  //       chrome.storage.local.set({ storedAccount: newStoredAccount }, () => {
  //       });
  //     }
  //   });
  // };

  // Watching for two state: new account index and the total number of accounts, so as soon as that account is added, switch over to it once. “enqueue” an account-switch (by setting pendingNewAccountIndex) and wait for the code that actually increases totalAccounts to finish before firing the switch.
  // useEffect(() => {
  //   if (pendingNewAccountIndex !== null && pendingNewAccountIndex < totalAccounts) {
  //     switchAccount(pendingNewAccountIndex);
  //     setPendingNewAccountIndex(null);
  //   }
  // }, [totalAccounts, pendingNewAccountIndex, switchAccount]);

  // const updateNetwork = (newNetwork: 'mainnet' | 'testnet') => {
  // setNetwork(newNetwork);
  // chrome.storage.local.get(['storedAccount'], res => {
  //   const storedAccount: StoredAccount | undefined = res.storedAccount;
  //   if (storedAccount) {
  //     storedAccount.network = newNetwork;
  //     chrome.storage.local.set({ storedAccount });
  //   }
  // });
  // };

  // const refreshAllBalances = useCallback(() => {
  // for (let i = 0; i < totalAccounts; i++) {
  //   refreshBalance(i);
  // }
  // }, [refreshBalance, totalAccounts]);

  //Refresh balances of all accounts when wallet chg or total account change
  // useEffect(() => {
  //   if (wallet) {
  //     refreshAllBalances();
  //   }
  // }, [wallet, refreshAllBalances]);

  // const refreshTxHistory = useCallback(
  //   (accountIndex: number) => {
  //     const now = Date.now();
  //     if (cachedTxHistories[accountIndex] && now - (lastTxFetchMap[accountIndex] || 0) < 60000) {
  //       return;
  //     }
  //     if (wallet) {
  //       const walletAddress = wallet.getAddress('bech32', accountIndex);
  //       if (walletAddress) {
  //         chrome.runtime.sendMessage({ action: 'getHistory', walletAddress }, response => {
  //           if (response?.success && response.history) {
  //             setCachedTxHistories(prev => ({
  //               ...prev,
  //               [accountIndex]: response.history,
  //             }));
  //             setLastTxFetchMap(prev => ({
  //               ...prev,
  //               [accountIndex]: now,
  //             }));
  //           }
  //         });
  //       }
  //     }
  //   },
  //   [cachedTxHistories, lastTxFetchMap, wallet],
  // );

  //On selectedAccountIndex change (or wallet init): refresh just the history
  // useEffect(() => {
  //   if (wallet) {
  //     refreshTxHistory(selectedAccountIndex);
  //   }
  // }, [wallet, selectedAccountIndex, refreshTxHistory]);

  // const logout = () => {
  //   chrome.runtime.sendMessage({ action: 'logout' }, response => {
  //     if (response && response.success) {
  //       /* empty */
  //     } else {
  //       console.warn('Logout failed.');
  //     }
  //   });
  //
  //   clearWallet();
  //
  //   chrome.storage.local.remove(['storedAccount'], () => {
  //     console.log('Local stored account data cleared.');
  //   });
  //
  //   setOnboarded(false);
  //
  //   setCachedBalances({});
  //   setLastBalanceFetchMap({});
  //   setCachedTxHistories({});
  //   setLastTxFetchMap({});
  //
  //   setGapLimit(500);
  // };

  // const setGapLimit = useCallback((newLimit: number) => {
  //   setGapLimitState(newLimit);
  //   chrome.storage.local.get(['storedAccount'], result => {
  //     const storedAccount = result.storedAccount;
  //     if (storedAccount) {
  //       const updatedAccount = { ...storedAccount, gapLimit: newLimit };
  //       chrome.storage.local.set({ storedAccount: updatedAccount }, () => {
  //         console.log('Persisted gapLimit to storedAccount:', newLimit);
  //       });
  //     } else {
  //       console.warn('No storedAccount found; gapLimit not persisted.');
  //     }
  //   });
  // }, []);

  // const getXpub = useCallback(async (): Promise<string> => {
  //   if (wallet && typeof wallet.getXpub === 'function') {
  //     return wallet.getXpub();
  //   }
  //   throw new Error('Wallet not unlocked or getXpub function not available');
  // }, [wallet]);

  return (
    <WalletContext.Provider
      value={{
        onboarded,
        unlocked,
        preferences,
        accounts,
        activeAccount,
        balance,
        transactions,
        setOnboarded,
        setUnlocked,
        setPreferences,
        refreshBalance,
        refreshTransactions,
        getReceivingAddress,
        init,
        logout,
        lock,
        // selectedAccountIndex,
        // totalAccounts,
        // selectedFiatCurrency,
        // onboarded,
        // isRestored,
        // network,
        // setWallet,
        // setSelectedAccountIndex,
        // setTotalAccounts,
        // setSelectedFiatCurrency,
        // switchAccount,
        // nextAccount,
        // addAccount,
        // createWallet,
        // restoreWallet,
        // unlockWallet,
        // clearWallet,
        // updateNetwork,
        // cachedBalances,
        // refreshAllBalances,
        // cachedTxHistories,
        // refreshTxHistory,
        // logout,
        // gapLimit,
        // setGapLimit,
        // getXpub,
      }}>
      {children}
    </WalletContext.Provider>
  );
};

export const useWalletContext = () => {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWalletContext must be used within a WalletProvider');
  }
  return context;
};
