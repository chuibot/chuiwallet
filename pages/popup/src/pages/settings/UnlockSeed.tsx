import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { InputField } from '@src/components/InputField';
import Header from '@src/components/Header';
import { ButtonOutline } from '@src/components/ButtonOutline';
import { usePasswordVerify } from '@src/hooks/usePasswordVerify';
import { ERROR_MESSAGES } from '@src/constants';

export const UnlockSeed: React.FC = () => {
  const navigate = useNavigate();
  const [password, setPassword] = React.useState('');
  const [emptyError, setEmptyError] = React.useState('');
  const { verify, loading, disabled, errorMsg } = usePasswordVerify();

  const handleReveal = async () => {
    setEmptyError('');

    if (!password) {
      setEmptyError(ERROR_MESSAGES.PLEASE_ENTER_PASSWORD);
      return;
    }

    const result = await verify(password);
    if (result.status === 'success') {
      navigate('/settings/advanced/reveal-seed');
    }
  };

  const displayError = emptyError || errorMsg;

  return (
    <div className="flex flex-col h-screen px-5 pt-12 pb-[19px] bg-dark">
      <Header title="Reveal seed phrase" hideClose={true} />
      <div className="mt-8 flex flex-col flex-1">
        <div className="flex flex-col items-center self-center max-w-full text-center w-full">
          <div className="mt-3 w-full text-lg leading-6 text-foreground max-sm:text-base">
            <span>Entering your password will reveal</span>
            <br />
            <span>this wallet's seed phrase</span>
          </div>
        </div>

        <div className="flex flex-col justify-between mt-6 w-full flex-1 text-lg font-bold leading-8 gap-3">
          <div className="flex flex-col justify-start gap-3">
            <InputField
              label="Input password"
              type="password"
              placeholder="Password"
              id="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  handleReveal();
                }
              }}
            />
            {displayError && (
              <span className="mt-1 text-xs font-italic text-primary-red font-light">{displayError}</span>
            )}
          </div>
          <ButtonOutline onClick={handleReveal} disabled={!password || disabled}>
            {loading ? 'Unlocking...' : 'Reveal seed phrase'}
          </ButtonOutline>
        </div>
      </div>
    </div>
  );
};

export default UnlockSeed;
