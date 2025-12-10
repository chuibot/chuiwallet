import type { BalanceData, Preferences } from '@src/types';
import type { Account } from '@extension/backend/src/types/wallet';
import type { TxEntry } from '@extension/backend/src/types/cache';
import type { ConnectionStatus } from '@extension/backend/src/types/electrum';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { sendMessage } from '@src/utils/bridge';
import { useChuiEvents } from '@src/hooks/useChuiEvents';
import { defaultPreferences } from '@extension/backend/src/preferenceManager';

interface WalletContextType {
  onboarded: boolean;
  unlocked: boolean;
  connected: ConnectionStatus;
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
  init: () => Promise<void>;
  logout: () => Promise<void>;
  lock: () => Promise<void>;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export const WalletProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [onboarded, setOnboarded] = useState<boolean>(false);
  const [unlocked, setUnlocked] = useState<boolean>(false);
  const [connected, setConnected] = useState<ConnectionStatus>('disconnected');
  const [preferences, setPreferences] = useState<Preferences>(defaultPreferences);
  const [accounts, _setAccounts] = useState<Account[]>([]);
  const [balance, _setBalance] = useState<BalanceData>();
  const [transactions, _setTransactions] = useState<TxEntry[]>([]);
  const activeAccount = useMemo<Account | undefined>(() => {
    const i = preferences?.activeAccountIndex ?? 0;
    return accounts[i];
  }, [accounts, preferences?.activeAccountIndex]);

  const init = async () => {
    const isRestorable = await sendMessage('wallet.restore');
    if (isRestorable) {
      setUnlocked(true);
      const preferences: Preferences = await sendMessage('preferences.get');
      const accounts = await sendMessage<Account[]>('accounts.get');
      setPreferences(preferences);
      _setAccounts(accounts);
    }
  };

  useChuiEvents({
    onConnection: e => setConnected(e.status as ConnectionStatus),
    onBalance: () => refreshBalance(),
    onTx: () => refreshTransactions(),
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
      const transactions = await sendMessage<TxEntry[]>('transactions.get');
      _setTransactions(transactions);
    })();
  };

  const getReceivingAddress = (): Promise<string> => {
    return (async () => {
      return await sendMessage('wallet.getReceivingAddress');
    })();
  };

  const lock = async () => {
    return (async () => {
      await sendMessage('wallet.lock');
      setUnlocked(false);
    })();
  };

  const logout = async () => {
    return (async () => {
      await sendMessage('wallet.logout');
      setOnboarded(false);
      setUnlocked(true);
    })();
  };

  return (
    <WalletContext.Provider
      value={{
        onboarded,
        unlocked,
        connected,
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
