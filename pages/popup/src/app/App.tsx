import { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { SetPassword } from '@src/pages/onboarding/SetPassword';
import { RestoreSeed } from '@src/pages/onboarding/RestoreSeed';
import { ChooseMethod } from '@src/pages/onboarding/ChooseMethod';
import { GenerateSeed } from '@src/pages/onboarding/GenerateSeed';
import { BackupSeed } from '@src/pages/onboarding/BackupSeed';
import { VerifySeed } from '@src/pages/onboarding/VerifySeed';
import { Complete } from '@src/pages/onboarding/Complete';
import { Dashboard } from '@src/pages/dashboard/Dashboard';
import { TransactionDetail } from '@src/pages/dashboard/TransactionDetail';
import { Activity } from '@src/pages/dashboard/Activity';
import { PasswordLock } from '@src/pages/lock/PasswordLock';
import { Settings } from '@src/pages/settings/Settings';
import { AdvancedSettings } from '@src/pages/settings/AdvancedSettings';
import { UnlockSeed } from '@src/pages/settings/UnlockSeed';
import { RevealSeed } from '@src/pages/settings/RevealSeed';
import { Receive } from '@src/pages/receive/Receive';
import { Send } from '@src/pages/send/Send';
import { SendOptions } from '@src/pages/send/SendOptions';
import { SendPreview } from '@src/pages/send/SendPreview';
import { SendStatus } from '@src/pages/send/SendStatus';
import { Accounts } from '@src/pages/accounts/Accounts';
import { useWalletContext } from '@src/context/WalletContext';
import { ProviderApproval } from '@src/pages/provider/Approval';
import { ErrorBanner } from '@src/components/ErrorBanner';
import Xpub from '@src/pages/settings/Xpub';
import Splash from '@src/pages/splash/Splash';

const RequireUnlocked: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { unlocked } = useWalletContext();
  const location = useLocation();

  if (!unlocked) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/locked?next=${next}`} replace />;
  }

  return <>{children}</>;
};

export const App: React.FC = () => {
  const { onboarded, unlocked } = useWalletContext();
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    const timer = setTimeout(
      () => {
        setShowSplash(false);
      },
      onboarded ? 500 : 1000,
    );
    return () => clearTimeout(timer);
  }, [onboarded]);

  if (showSplash) {
    return <Splash />;
  }

  return (
    <>
      <ErrorBanner isCloseable />
      <Routes>
        {onboarded ? (
          unlocked ? (
            <>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
            </>
          ) : (
            <Route path="*" element={<PasswordLock />} />
          )
        ) : (
          <Route path="/" element={<Navigate to="/onboard/set-password" replace />} />
        )}

        <Route
          path="/provider/approve"
          element={
            <RequireUnlocked>
              <ProviderApproval />
            </RequireUnlocked>
          }
        />

        <Route path="/onboard/set-password" element={<SetPassword />} />
        <Route path="/onboard/choose-method" element={<ChooseMethod />} />
        <Route path="/onboard/restore-seed" element={<RestoreSeed />} />
        <Route path="/onboard/generate-seed" element={<GenerateSeed />} />
        <Route path="/onboard/backup-seed" element={<BackupSeed />} />
        <Route path="/onboard/verify-seed" element={<VerifySeed />} />
        <Route path="/onboard/complete" element={<Complete />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/dashboard/:currency/activity" element={<Activity />} />
        <Route path="/dashboard/:currency/activity/:txnHash/detail" element={<TransactionDetail />} />
        <Route path="/send/:currency" element={<Send />} />
        <Route path="/send/:currency/options" element={<SendOptions />} />
        <Route path="/send/:currency/preview" element={<SendPreview />} />
        <Route path="/send/:currency/status" element={<SendStatus />} />
        <Route path="/receive/:currency" element={<Receive />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/settings/advanced" element={<AdvancedSettings />} />
        <Route path="/settings/advanced/unlock-seed" element={<UnlockSeed />} />
        <Route path="/settings/advanced/reveal-seed" element={<RevealSeed />} />
        <Route path="/settings/advanced/xpub" element={unlocked ? <Xpub /> : <PasswordLock />} />
        <Route path="/accounts" element={<Accounts />} />
        <Route path="/locked" element={<PasswordLock />} />
      </Routes>
    </>
  );
};

export default App;
