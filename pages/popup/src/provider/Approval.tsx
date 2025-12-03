import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { sendMessage } from '@src/utils/bridge';
import { Button } from '@src/components/Button';
import type * as React from 'react';

type RpcRequest = {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
};

type ApprovalData = {
  id: number;
  origin: string;
  rpc: RpcRequest;
};

export const ProviderApproval: React.FC = () => {
  const location = useLocation();
  const search = new URLSearchParams(location.search);
  const idParam = search.get('id');
  const approvalId = idParam ? Number(idParam) : NaN;

  const [loading, setLoading] = useState(true);
  const [approval, setApproval] = useState<ApprovalData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isFinite(approvalId)) {
      setError('Invalid approval id');
      setLoading(false);
      return;
    }

    (async () => {
      try {
        const data = await sendMessage<ApprovalData>('provider.getApproval', { id: approvalId });
        setApproval(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [approvalId]);

  const handleApprove = async () => {
    if (!approval) return;
    await sendMessage('provider.resolveApproval', { id: approval.id, approved: true });
    window.close();
  };

  const handleReject = async () => {
    if (!approval) return;
    await sendMessage('provider.resolveApproval', { id: approval.id, reason: 'User rejected' });
    window.close();
  };

  if (loading) {
    return <div className="p-4 text-sm">Loading request…</div>;
  }

  if (error || !approval) {
    return <div className="p-4 text-sm text-red-500">Error loading request: {error ?? 'Unknown error'}</div>;
  }

  const { origin, rpc } = approval;

  return (
    <div className="flex flex-col justify-start items-start text-white bg-dark h-[600px] px-4 pt-12">
      <div className="absolute top-0 left-0 w-full min-h-[48px] flex gap-5 justify-between items-center p-3 text-xl leading-none text-center whitespace-nowrap bg-dark mb-6">
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

      <div className="mt-6">
        <div className="text-sm text-white mb-6">
          <div className="font-medium text-white mb-1">Website</div>
          <div className="break-all font-bold">{origin}</div>
        </div>

        <div className="text-sm text-white mb-6">
          <div className="font-medium text-white mb-1">Requested method</div>
          <div className="font-bold">{rpc.method}</div>
        </div>

        {/* Abstract to control file */}
        {rpc.method === 'getXpub' && (
          <p className="text-sm text-white">
            This website is requesting access to your extended public key (xpub). This lets it derive all your receiving
            addresses and track your wallet history.
          </p>
        )}
      </div>

      <div className="fixed bottom-[19px] w-full">
        <Button className="flex justify-center gap-2 w-full bg-opacity-0 text-white" onClick={handleReject}>
          Reject
        </Button>
        <Button className="flex justify-center gap-2 w-full" onClick={handleApprove}>
          Approve
        </Button>
      </div>
    </div>
  );
};
