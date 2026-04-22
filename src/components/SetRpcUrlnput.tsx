'use client';

import { useState } from 'react';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { toast } from 'sonner';
import { useRpcUrl } from '~/hooks/useSettings'; // Now using React Query!
import { isValidRpcUrl, normalizeRpcUrl } from '@/lib/rpcUrl';

const SetRpcUrlInput = ({ onUpdate }: { onUpdate?: () => void }) => {
  const { rpcUrl: storedRpcUrl, setRpcUrl } = useRpcUrl(); // Use React Query
  const [rpcUrl, setRpcUrlState] = useState(storedRpcUrl || '');

  const onSubmit = async () => {
    const normalizedRpcUrl = normalizeRpcUrl(rpcUrl);
    if (normalizedRpcUrl) {
      await setRpcUrl.mutateAsync(normalizedRpcUrl); // Use React Query mutation
      setRpcUrlState(''); // Clear input field after submission
      if (onUpdate) onUpdate();
    } else {
      throw 'Please enter a valid HTTP(S) RPC URL.';
    }
  };

  return (
    <div>
      <Input
        onChange={(e) => setRpcUrlState(e.target.value.trim())}
        placeholder={storedRpcUrl || 'https://api.mainnet-beta.solana.com or localhost:8899'}
        value={rpcUrl} // Sync input state with stored value
        className=""
      />
      {!isValidRpcUrl(rpcUrl) && rpcUrl.length > 0 && (
        <p className="mt-2 text-xs">Please enter a valid HTTP(S) RPC URL.</p>
      )}
      <Button
        onClick={() =>
          toast.promise(onSubmit(), {
            loading: 'Updating RPC URL...',
            success: 'RPC URL set successfully.',
            error: (err) => `${err}`,
          })
        }
        disabled={!isValidRpcUrl(rpcUrl) && rpcUrl.length > 0}
        className="mt-2"
      >
        Set RPC Url
      </Button>
    </div>
  );
};

export default SetRpcUrlInput;
