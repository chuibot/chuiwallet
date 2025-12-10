import { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { SetPassword } from '@src/02_SetPassword/SetPassword';
import { RestoreSeed } from '@src/03_CreateWallet/RestoreSeed';
import { ChooseMethod } from '@src/03_CreateWallet/ChooseMethod';
import { GenerateSeed } from '@src/03_CreateWallet/GenerateSeed';
import { BackupSeed } from '@src/03_CreateWallet/BackupSeed';
import { VerifySeed } from '@src/03_CreateWallet/VerifySeed';
import { Complete } from '@src/03_CreateWallet/Complete';
import { Dashboard } from '@src/04_Dashboard/Dashboard';
import { TransactionDetail } from '@src/04_Dashboard/[currency]/TransactionDetail';
import { Activity } from '@src/04_Dashboard/[currency]/Activity';
import { PasswordLock } from '@src/05_PasswordLock/PasswordLock';
import { Settings } from '@src/06_Settings/Settings';
import { AdvancedSettings } from '@src/06_Settings/AdvancedSettings';
import { UnlockSeed } from '@src/06_Settings/UnlockSeed';
import { RevealSeed } from '@src/06_Settings/RevealSeed';
import { Receive } from '@src/07_Receive/[currency]/Receive';
import { Send } from '@src/08_Send/[currency]/Send';
import { SendOptions } from '@src/08_Send/[currency]/SendOptions';
import { SendPreview } from '@src/08_Send/[currency]/SendPreview';
import { SendStatus } from '@src/08_Send/[currency]/SendStatus';
import { Accounts } from '@src/09_Accounts/Accounts';
import { useWalletContext } from '@src/context/WalletContext';
import { Banner } from '@src/components/Banner';
import { ProviderApproval } from '@src/provider/Approval';
import Xpub from '@src/06_Settings/Xpub';
import Splash from '@src/01_Splash/Splash';

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
      <Banner />
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
