import { useRef, useState } from 'react';
import { PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { Button } from './ui/button';
import { formatTransactionError } from '@/lib/utils';
import * as multisig from '@sqds/multisig';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { toast } from 'sonner';
import { useAccess } from '../hooks/useAccess';
import { waitForConfirmation } from '../lib/transactionConfirmation';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useMultisigData } from '../hooks/useMultisigData';
import { buildProposalIx } from '../lib/multisigUtils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog';
import TransactionNoteInput from './TransactionNoteInput';
import { sendRawWalletTransaction } from '@/lib/sendRawWalletTransaction';

type RemoveMemberButtonProps = {
  multisigPda: string;
  transactionIndex: number;
  memberKey: string;
  programId: string;
};

const RemoveMemberButton = ({
  multisigPda,
  transactionIndex,
  memberKey,
  programId,
}: RemoveMemberButtonProps) => {
  const wallet = useWallet();
  const walletModal = useWalletModal();
  const isMember = useAccess();
  const member = new PublicKey(memberKey);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { connection } = useMultisigData();
  const signatureRef = useRef<string>('');
  const [isPending, setIsPending] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [note, setNote] = useState('');

  const removeMember = async () => {
    if (!wallet.publicKey) {
      walletModal.setVisible(true);
      throw 'Wallet not connected';
    }

    const bigIntTransactionIndex = BigInt(transactionIndex);
    const resolvedProgramId = programId ? new PublicKey(programId) : multisig.PROGRAM_ID;

    const removeMemberIx = multisig.instructions.configTransactionCreate({
      multisigPda: new PublicKey(multisigPda),
      actions: [
        {
          __kind: 'RemoveMember',
          oldMember: member,
        },
      ],
      creator: wallet.publicKey,
      transactionIndex: bigIntTransactionIndex,
      rentPayer: wallet.publicKey,
      memo: note.trim() || undefined,
      programId: resolvedProgramId,
    });
    const proposalIx = buildProposalIx(
      new PublicKey(multisigPda),
      wallet.publicKey,
      bigIntTransactionIndex,
      resolvedProgramId
    );

    const message = new TransactionMessage({
      instructions: [removeMemberIx, proposalIx],
      payerKey: wallet.publicKey,
      recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
    }).compileToV0Message();

    const transaction = new VersionedTransaction(message);

    toast.loading('Waiting for wallet approval...', { id: 'transaction', duration: Infinity });

    const signature = await sendRawWalletTransaction(wallet, connection, transaction, {
      skipPreflight: true,
    });
    signatureRef.current = signature;

    const shortSig = `${signature.slice(0, 8)}...${signature.slice(-4)}`;
    toast.info(`Sent: ${signature}`, { duration: 6000 });
    toast.info(`Confirming: ${shortSig}`, { id: 'transaction', duration: Infinity });

    const [confirmed] = await waitForConfirmation(connection, [signature]);
    if (!confirmed) {
      throw `Transaction failed or timed out. Check ${signature}`;
    }

    toast.success(`Remove member action proposed. (${signature})`, { id: 'transaction' });
    setNote('');
    setIsOpen(false);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['transactions'] }),
      queryClient.invalidateQueries({ queryKey: ['multisig'] }),
    ]);
    navigate('/transactions');
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={!isMember || isPending}>
          Remove
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove Member</DialogTitle>
          <DialogDescription>Propose removing {memberKey} from the multisig.</DialogDescription>
        </DialogHeader>
        <TransactionNoteInput
          id="remove-member-note"
          value={note}
          onChange={setNote}
          description="Optional note/memo to include with the remove-member proposal."
        />
        <Button
          disabled={isPending}
          onClick={async () => {
            setIsPending(true);
            try {
              await removeMember();
            } catch (e) {
              toast.error(
                `Failed to propose: ${formatTransactionError(e)}${signatureRef.current ? ` (${signatureRef.current})` : ''}`,
                { id: 'transaction' }
              );
            } finally {
              setIsPending(false);
            }
          }}
        >
          Confirm Remove
        </Button>
      </DialogContent>
    </Dialog>
  );
};

export default RemoveMemberButton;
