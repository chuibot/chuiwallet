import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { InputField } from '../components/InputField';
import { TermsCheckbox } from '../components/TermsCheckbox';
import { Button } from '@src/components/Button';
import { getPasswordStrength } from '@src/utils';
import { setSessionPassword } from '@extension/backend/dist/utils/sessionStorageHelper';
import { ERRORS, MIN_PASSWORD_LENGTH } from '@src/constants';

export const SetPassword: React.FC = () => {
  const navigate = useNavigate();
  const [password, setPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [termsAccepted, setTermsAccepted] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState('');
  const [noMatchMsg, setNoMatchMsg] = React.useState('');
  const passwordStrength = getPasswordStrength(password);

  let strengthColorClass = 'text-primary-red';
  if (passwordStrength === 'medium') {
    strengthColorClass = 'text-primary-yellow';
  } else if (passwordStrength === 'strong') {
    strengthColorClass = 'text-primary-green';
  }

  const handleNext = async () => {
    setErrorMsg('');
    setNoMatchMsg('');

    if (!password) {
      setErrorMsg(ERRORS.PASSWORD_REQUIRED);
      return;
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      setErrorMsg(ERRORS.PASSWORD_TOO_SHORT);
      return;
    }

    if (password !== confirmPassword) {
      setNoMatchMsg(ERRORS.PASSWORDS_DO_NOT_MATCH);
      return;
    }

    if (passwordStrength !== 'strong') {
      setErrorMsg(ERRORS.PLEASE_CHOOSE_STRONGER_PASSWORD);
      return;
    }

    if (!termsAccepted) {
      setErrorMsg(ERRORS.PLEASE_ACCEPT_TERMS);
      return;
    }
    await setSessionPassword(password);
    navigate('/onboard/choose-method');
  };

  const handlePasswordConfirmation = (passwordConfirmation: string) => {
    if (passwordConfirmation !== password) {
      setNoMatchMsg(ERRORS.PASSWORDS_DO_NOT_MATCH);
    } else {
      setNoMatchMsg('');
    }
  };

  return (
    <div className="relative flex flex-col h-screen px-5 pt-12 pb-[19px] bg-dark">
      <div className="flex flex-col flex-1">
        <div className="flex flex-col items-center self-center max-w-full text-center w-full">
          <h1 className="w-full text-2xl font-bold leading-loose text-white max-sm:text-2xl">Set up a password</h1>
          <div className="mt-3 w-full text-lg leading-6 text-foreground max-sm:text-base">
            <span>It will be used to access Chui</span>
            <br />
            <span>on this browser</span>
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
            />

            {password && (
              <span className={`text-xs ${strengthColorClass}`}>
                {passwordStrength === 'weak' ? 'Weak' : passwordStrength === 'medium' ? 'Medium' : 'Strong'}
              </span>
            )}

            <InputField
              label="Confirm password"
              type="password"
              placeholder="Confirm password"
              id="confirmPassword"
              value={confirmPassword}
              onBlur={e => handlePasswordConfirmation(e.target.value)}
              onChange={e => setConfirmPassword(e.target.value)}
            />
            {noMatchMsg && <span className="mt-1 text-xs text-primary-red font-light">{noMatchMsg}</span>}
            <span className="mt-2 text-xs text-neutral-400 font-normal">
              Password must be at least {MIN_PASSWORD_LENGTH} characters and include uppercase, lowercase, numbers, and
              special characters.
            </span>

            <TermsCheckbox onAcceptChange={setTermsAccepted} />

            {errorMsg && <span className="mt-1 text-xs text-primary-red font-light">{errorMsg}</span>}
          </div>
        </div>
      </div>

      <Button className="absolute w-full bottom-[19px]" onClick={handleNext} tabIndex={0}>
        Next
      </Button>
    </div>
  );
};
