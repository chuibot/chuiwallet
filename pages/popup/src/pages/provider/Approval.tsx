import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { sendMessage } from '@src/utils/bridge';
import { Button } from '@src/components/Button';
import { ConnectionNotice } from '@src/components/ConnectionNotice';
import { Dropdown } from '@src/components/Dropdown';
import type * as React from 'react';

type RpcRequest = {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
};

type ApprovalAccount = {
  listIndex: number;
  name: string;
};

type ApprovalData = {
  id: string;
  origin: string;
  rpc: RpcRequest;
  accounts: ApprovalAccount[];
  activeAccountListIndex: number;
};

const METHOD_COPY: Record<string, string> = {
  getXpub:
    'This website is requesting access to your Bitcoin extended public key (xpub). This lets it derive all your Bitcoin receiving addresses and track your Bitcoin wallet history.',
  getAddresses:
    'This website is requesting your Bitcoin receiving address, Bitcoin change address, and your EVM address. This lets it identify your wallet addresses and monitor incoming and outgoing payments.',
  getXpubAddresses:
    'This website is requesting your Bitcoin xpub together with your Bitcoin receiving address, Bitcoin change address, and your EVM address. The xpub lets it derive all your Bitcoin receiving addresses and track your Bitcoin wallet history.',
};

export const ProviderApproval: React.FC = () => {
  const location = useLocation();
  const search = new URLSearchParams(location.search);
  const approvalId = search.get('id') ?? '';

  const [loading, setLoading] = useState(true);
  const [approval, setApproval] = useState<ApprovalData | null>(null);
  const [selectedAccountIndex, setSelectedAccountIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!approvalId) {
      setError('Invalid approval id');
      setLoading(false);
      return;
    }

    (async () => {
      try {
        const data = await sendMessage<ApprovalData>('provider.getApproval', { id: approvalId });
        setApproval(data);
        const preselected = data.accounts.find(account => account.listIndex === data.activeAccountListIndex);
        setSelectedAccountIndex((preselected ?? data.accounts[0])?.listIndex ?? null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [approvalId]);

  const handleApprove = async () => {
    if (!approval || selectedAccountIndex === null) return;
    await sendMessage('provider.resolveApproval', {
      id: approval.id,
      approved: true,
      accountIndex: selectedAccountIndex,
    });
    window.close();
  };

  const handleReject = async () => {
    if (!approval) return;
    await sendMessage('provider.rejectApproval', { id: approval.id, reason: 'User rejected' });
    window.close();
  };

  if (loading) {
    return <div className="p-4 text-sm">Loading request…</div>;
  }

  if (error || !approval) {
    return <div className="p-4 text-sm text-red-500">Error loading request: {error ?? 'Unknown error'}</div>;
  }

  const { origin, rpc, accounts } = approval;
  const methodDescription = METHOD_COPY[rpc.method];
  const isUnknownOrigin = origin === 'unknown';
  const selectedAccount = accounts.find(account => account.listIndex === selectedAccountIndex);
  const hasAccountChoice = accounts.length > 1;

  return (
    <div className="flex h-full min-h-0 flex-col bg-dark text-white">
      <div className="flex min-h-[48px] shrink-0 items-center justify-between gap-5 bg-dark p-3 text-center text-xl leading-none whitespace-nowrap">
        <button></button>

        <div className="self-stretch w-[262px] font-bold leading-6 text-white">Connection Request</div>

        <button onClick={handleReject}>
          <img
            loading="lazy"
            src={chrome.runtime.getURL(`popup/close_icon.svg`)}
            alt=""
            className="object-contain shrink-0 self-stretch my-auto w-6 aspect-square"
          />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-6">
        <div className="text-sm text-white mb-6">
          <div className="font-medium text-white mb-1">Website</div>
          <div className="break-all font-bold">
            <bdi dir="ltr">{origin}</bdi>
          </div>
          {isUnknownOrigin && (
            <div className="mt-1 text-xs text-red-400">
              Request from an unverified or non-web origin. Approval is blocked.
            </div>
          )}
        </div>

        <div className="text-sm text-white mb-6">
          <div className="font-medium text-white mb-1">Requested method</div>
          <div className="font-bold">{rpc.method}</div>
        </div>

        <div className="text-sm text-white mb-6">
          <div className="font-medium text-white mb-1">Connect with</div>
          {hasAccountChoice ? (
            <Dropdown
              options={accounts.map(account => account.name)}
              selected={selectedAccount?.name}
              label="Select account"
              onSelect={name => {
                const picked = accounts.find(account => account.name === name);
                if (picked) setSelectedAccountIndex(picked.listIndex);
              }}
            />
          ) : (
            <div className="font-bold">{selectedAccount?.name ?? 'No account available'}</div>
          )}
          {hasAccountChoice && (
            <p className="mt-2 text-xs text-foreground-79">
              Only this account is shared. Choosing one here does not switch your wallet.
            </p>
          )}
        </div>

        {methodDescription && <p className="text-sm text-white">{methodDescription}</p>}

        <ConnectionNotice className="mt-6 !text-left" />
      </div>

      <div className="flex shrink-0 flex-col gap-3 px-4 pt-3 pb-[19px]">
        <Button className="self-center bg-opacity-0 text-white" onClick={handleReject}>
          Reject
        </Button>
        <Button className="self-center" onClick={handleApprove} disabled={isUnknownOrigin || !selectedAccount}>
          Approve
        </Button>
      </div>
    </div>
  );
};
