import * as React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { InputField } from '@src/components/InputField';
import { Button } from '@src/components/Button';
import { setSessionPassword } from '@extension/backend/src/utils/sessionStorageHelper';
import { useWalletContext } from '@src/context/WalletContext';

export const PasswordLock: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const [password, setPassword] = React.useState('');
  const [errorMsg, setErrorMsg] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const { init } = useWalletContext();

  const params = new URLSearchParams(location.search);
  const next = params.get('next') || '/dashboard';

  const handleUnlock = async () => {
    setErrorMsg('');

    if (!password) {
      setErrorMsg('Please enter your password.');
      return;
    }

    setLoading(true);

    try {
      await setSessionPassword(password);
      await init();
      navigate(next, { replace: true });
    } catch (err) {
      console.error(err);
      setErrorMsg('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen px-5 pt-12 pb-[19px] bg-dark">
      <div className="flex flex-col flex-1">
        <div className="flex flex-col items-center justify-center max-w-full text-center w-full">
          <div className="flex justify-center w-full mb-[106px]">
            <img
              loading="lazy"
              src={chrome.runtime.getURL('popup/logo_light.svg')}
              alt=""
              className="object-contain shrink-0 self-stretch my-auto w-[127px] h-[42px] aspect-square"
            />
          </div>
          <h1 className="w-full text-2xl font-bold leading-loose text-white max-sm:text-2xl">Welcome!</h1>
          <div className="mt-3 w-full text-lg leading-6 text-foreground max-sm:text-base">
            <span>Chui is ready for you</span>
          </div>
        </div>

        <div className="flex flex-col justify-between mt-6 w-full flex-1 text-lg font-bold leading-8 gap-3">
          <div className="flex flex-col justify-start gap-3">
            <InputField
              label="Password"
              type="password"
              placeholder="Password"
              id="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  handleUnlock();
                }
              }}
            />

            {errorMsg && <span className="mt-1 text-xs font-italic text-primary-red font-light">{errorMsg}</span>}
          </div>

          <Button onClick={handleUnlock} tabIndex={0} disabled={loading || !password}>
            {loading ? 'Unlocking...' : 'Unlock'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default PasswordLock;
