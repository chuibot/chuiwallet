import type { BalanceData, Network, Preferences } from '@src/types';
import type { Account } from '@extension/backend/src/types/wallet';
import type { TxEntry } from '@extension/backend/src/types/cache';
import type { ConnectionStatus } from '@extension/backend/src/types/electrum';
import type { ChainBalance } from '@extension/backend/src/adapters/IChainAdapter';
import { ChainType } from '@extension/backend/src/adapters/IChainAdapter';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { sendMessage } from '@src/utils/bridge';
import { useChuiEvents } from '@src/hooks/useChuiEvents';
import { defaultPreferences } from '@extension/backend/src/preferenceManager';

interface WalletContextType {
  onboarded: boolean;
  unlocked: boolean;
  isBackedUp: boolean;
  connected: ConnectionStatus;
  setOnboarded: (onboarded: boolean) => void;
  setUnlocked: (unlocked: boolean) => void;
  setIsBackedUp: (isBackedUp: boolean) => void;
  preferences: Preferences;
  setPreferences: (preferences: Preferences) => void;
  accounts: Account[];
  activeAccount: Account | undefined;
  addAccount: () => Promise<void>;
  switchAccount: (accountIndex: number) => Promise<void>;
  switchNetwork: (network: Network) => Promise<void>;
  balance: BalanceData | undefined;
  refreshBalance: () => void;
  transactions: TxEntry[];
  refreshTransactions: () => void;
  getReceivingAddress: () => Promise<string>;
  /** Multi-chain balances keyed by ChainType */
  chainBalances: Partial<Record<ChainType, ChainBalance>>;
  refreshChainBalances: () => void;
  /** Get receiving address for a specific chain */
  getChainReceivingAddress: (chain: ChainType) => Promise<string>;
  init: () => Promise<void>;
  logout: () => Promise<void>;
  lock: () => Promise<void>;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export const WalletProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [onboarded, setOnboarded] = useState<boolean>(false);
  const [unlocked, setUnlocked] = useState<boolean>(false);
  const [isBackedUp, setIsBackedUp] = useState<boolean>(false);
  const [connected, setConnected] = useState<ConnectionStatus>('disconnected');
  const [preferences, setPreferences] = useState<Preferences>(defaultPreferences);
  const [accounts, _setAccounts] = useState<Account[]>([]);
  const [balance, _setBalance] = useState<BalanceData>();
  const [transactions, _setTransactions] = useState<TxEntry[]>([]);
  const [chainBalances, _setChainBalances] = useState<Partial<Record<ChainType, ChainBalance>>>({});
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
      // This ensures your UI state matches what is in storage
      setIsBackedUp(!!preferences.isWalletBackedUp);
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

  const refreshAccounts = async () => {
    const accounts = await sendMessage<Account[]>('accounts.get');
    _setAccounts(accounts);
    return accounts;
  };

  const switchAccount = async (accountIndex: number) => {
    const nextPreferences: Preferences = await sendMessage('accounts.switch', { accountIndex });
    setPreferences(nextPreferences);
    await refreshAccounts();
    refreshBalance();
    refreshChainBalances();
    refreshTransactions();
  };

  const addAccount = async () => {
    const result = await sendMessage<{ preferences: Preferences; accounts: Account[] }>('accounts.create');
    setPreferences(result.preferences);
    _setAccounts(result.accounts);
    refreshBalance();
    refreshChainBalances();
    refreshTransactions();
  };

  const switchNetwork = async (network: Network) => {
    await sendMessage('wallet.switchNetwork', { network });
    const nextPreferences: Preferences = await sendMessage('preferences.get');
    setPreferences(nextPreferences);
    await refreshAccounts();
    refreshBalance();
    refreshChainBalances();
    refreshTransactions();
  };

  const getReceivingAddress = (): Promise<string> => {
    return (async () => {
      return await sendMessage('wallet.getReceivingAddress');
    })();
  };

  const refreshChainBalances = () => {
    (async () => {
      try {
        const balances = await sendMessage<Record<string, ChainBalance>>('chain.getAllBalances');
        _setChainBalances(balances as Partial<Record<ChainType, ChainBalance>>);
      } catch (e) {
        console.error('Failed to fetch chain balances', e);
      }
    })();
  };

  const getChainReceivingAddress = async (chain: ChainType): Promise<string> => {
    return sendMessage<string>('chain.getReceivingAddress', { chain });
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
      setIsBackedUp(false);
      setOnboarded(false);
      setUnlocked(true);
    })();
  };

  return (
    <WalletContext.Provider
      value={{
        onboarded,
        unlocked,
        isBackedUp,
        connected,
        preferences,
        accounts,
        activeAccount,
        addAccount,
        switchAccount,
        switchNetwork,
        balance,
        transactions,
        setOnboarded,
        setUnlocked,
        setIsBackedUp,
        setPreferences,
        refreshBalance,
        refreshTransactions,
        getReceivingAddress,
        chainBalances,
        refreshChainBalances,
        getChainReceivingAddress,
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
