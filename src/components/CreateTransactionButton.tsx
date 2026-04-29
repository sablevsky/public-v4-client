import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import * as bs58 from 'bs58';
import { Button } from './ui/button';
import { formatTransactionError } from '@/lib/utils';
import { useEffect, useState } from 'react';
import * as multisig from '@sqds/multisig';
import { useWallet } from '@solana/wallet-adapter-react';
import { Message, PublicKey, TransactionInstruction } from '@solana/web3.js';
import { Input } from './ui/input';
import { toast } from 'sonner';
import { simulateEncodedTransaction } from '@/lib/transaction/simulateEncodedTransaction';
import { importTransaction } from '@/lib/transaction/importTransaction';
import { useMultisigData } from '@/hooks/useMultisigData';
import { useAccess } from '@/hooks/useAccess';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import invariant from 'invariant';
import { VaultSelector } from './VaultSelector';
import TransactionNoteInput from './TransactionNoteInput';
import {
  decodeTransactionMessage,
  detectEphemeralSignersForTransaction,
  parseEphemeralSigners,
  parseLookupTableAddresses,
} from '@/lib/transaction/decodeAndDeserialize';
import { useMultisig } from '@/hooks/useServices';

const CreateTransaction = () => {
  const wallet = useWallet();
  const hasAccess = useAccess();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [tx, setTx] = useState('');
  const [open, setOpen] = useState(false);
  const [ephemeralSigners, setEphemeralSigners] = useState('0');
  const [ephemeralSignersManuallyEdited, setEphemeralSignersManuallyEdited] = useState(false);
  const [lookupTableAddresses, setLookupTableAddresses] = useState('');
  const [note, setNote] = useState('');
  const [detectedEphemeralSignerIndexes, setDetectedEphemeralSignerIndexes] = useState<number[]>(
    []
  );

  const { connection, multisigAddress, vaultIndex, programId } = useMultisigData();
  const { data: multisigInfo } = useMultisig();

  const nextTransactionIndex = multisigInfo
    ? BigInt(Number(multisigInfo.transactionIndex) + 1)
    : null;

  useEffect(() => {
    if (!tx || !multisigAddress || !nextTransactionIndex) {
      setDetectedEphemeralSignerIndexes([]);
      if (!ephemeralSignersManuallyEdited) {
        setEphemeralSigners('0');
      }
      return;
    }

    try {
      const { staticAccountKeys } = decodeTransactionMessage(tx);
      const detection = detectEphemeralSignersForTransaction({
        staticAccountKeys,
        multisigPda: new PublicKey(multisigAddress),
        transactionIndex: nextTransactionIndex,
        programId,
      });

      setDetectedEphemeralSignerIndexes(detection.matchedEphemeralSignerIndexes);
      if (!ephemeralSignersManuallyEdited) {
        setEphemeralSigners(String(detection.ephemeralSigners));
      }
    } catch (error) {
      setDetectedEphemeralSignerIndexes([]);
      if (!ephemeralSignersManuallyEdited) {
        setEphemeralSigners('0');
      }
    }
  }, [ephemeralSignersManuallyEdited, multisigAddress, nextTransactionIndex, programId, tx]);

  const getParsedImportOptions = () => {
    return {
      additionalLookupTableAddresses: parseLookupTableAddresses(lookupTableAddresses),
      ephemeralSigners: parseEphemeralSigners(ephemeralSigners),
    };
  };

  const getDetectedEphemeralSignerCount = () => {
    if (!detectedEphemeralSignerIndexes.length) {
      return 0;
    }

    return detectedEphemeralSignerIndexes[detectedEphemeralSignerIndexes.length - 1] + 1;
  };

  const getSampleMessage = async () => {
    invariant(programId, 'Program ID not found');
    invariant(multisigAddress, 'Multisig address not found. Please create a multisig first.');
    invariant(wallet.publicKey, 'Wallet ID not found');

    const memo = 'Hello from Solana land!';
    const vaultAddress = multisig.getVaultPda({
      index: vaultIndex,
      multisigPda: new PublicKey(multisigAddress),
      programId: programId,
    })[0];

    const dummyMessage = Message.compile({
      instructions: [
        new TransactionInstruction({
          keys: [
            {
              pubkey: wallet.publicKey,
              isSigner: true,
              isWritable: true,
            },
          ],
          data: Buffer.from(memo, 'utf-8'),
          programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
        }),
      ],
      payerKey: vaultAddress,
      recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
    });

    const encoded = bs58.default.encode(dummyMessage.serialize());

    setTx(encoded);
    setEphemeralSignersManuallyEdited(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen} modal={false}>
      <DialogTrigger
        className={`h-10 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground ${!hasAccess ? `bg-primary/50 hover:bg-primary/50` : `hover:bg-primary/90`}`}
        disabled={!hasAccess}
      >
        Import Transaction
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import Transaction</DialogTitle>
          <DialogDescription>
            Propose a transaction from a base58 encoded transaction message (not a transaction).
          </DialogDescription>
        </DialogHeader>
        <div className={`flex items-center justify-between gap-2`}>
          <p>Using Vault Index:</p>
          <VaultSelector />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="import-transaction-message">
            Transaction message
          </label>
          <Input
            id="import-transaction-message"
            placeholder="Paste base58 encoded transaction..."
            type="text"
            value={tx}
            onChange={(e) => {
              setTx(e.target.value.trim());
              setEphemeralSignersManuallyEdited(false);
            }}
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label className="text-sm font-medium" htmlFor="import-transaction-ephemeral-signers">
              Ephemeral signers
            </label>
            <button
              type="button"
              className="text-xs text-muted-foreground underline hover:text-foreground"
              onClick={() => {
                setEphemeralSigners(String(getDetectedEphemeralSignerCount()));
                setEphemeralSignersManuallyEdited(false);
              }}
            >
              Use auto-detected value
            </button>
          </div>
          <Input
            id="import-transaction-ephemeral-signers"
            type="number"
            min={0}
            max={255}
            value={ephemeralSigners}
            onChange={(e) => {
              setEphemeralSigners(e.target.value);
              setEphemeralSignersManuallyEdited(true);
            }}
          />
          <p className="text-xs text-muted-foreground">
            {detectedEphemeralSignerIndexes.length
              ? `Auto-detected ${getDetectedEphemeralSignerCount()} ephemeral signer${getDetectedEphemeralSignerCount() === 1 ? '' : 's'} from signer index${detectedEphemeralSignerIndexes.length === 1 ? '' : 'es'} ${detectedEphemeralSignerIndexes.join(', ')}.`
              : 'Auto-fills from the next Squads transaction PDA when the imported message matches an ephemeral signer.'}
          </p>
          {detectedEphemeralSignerIndexes.length > 1 &&
            getDetectedEphemeralSignerCount() !== detectedEphemeralSignerIndexes.length && (
              <p className="text-xs text-muted-foreground">
                The count follows the highest matched ephemeral signer index because Squads
                allocates ephemeral signer PDAs sequentially.
              </p>
            )}
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="import-transaction-alts">
            Extra address lookup tables
          </label>
          <textarea
            id="import-transaction-alts"
            className="flex min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            placeholder="One lookup table address per line, space, or comma"
            value={lookupTableAddresses}
            onChange={(e) => setLookupTableAddresses(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Existing lookup tables referenced by a v0 message are loaded automatically. Add extra
            lookup table addresses here to recompile the imported message against them before
            simulation and proposal.
          </p>
        </div>
        <TransactionNoteInput
          id="import-transaction-note"
          label="Note"
          value={note}
          onChange={setNote}
          description="Optional note/memo to include with the Squads transaction proposal."
        />
        <div className="flex items-center justify-end gap-2">
          <Button
            onClick={() => {
              toast('Note: Simulations may fail on alt-SVM', {
                description: 'Please verify via an explorer before submitting.',
              });
              toast.promise(
                (async () => {
                  const { additionalLookupTableAddresses } = getParsedImportOptions();

                  await simulateEncodedTransaction({
                    tx,
                    connection,
                    wallet,
                    additionalLookupTableAddresses,
                  });
                })(),
                {
                  id: 'simulation',
                  loading: 'Building simulation...',
                  success: 'Simulation successful.',
                  error: (e) => formatTransactionError(e),
                }
              );
            }}
          >
            Simulate
          </Button>
          {multisigAddress && (
            <Button
              onClick={async () => {
                try {
                  const parsedOptions = getParsedImportOptions();
                  const signature = await importTransaction({
                    tx,
                    connection,
                    multisigPda: multisigAddress,
                    programId: programId.toBase58(),
                    vaultIndex,
                    wallet,
                    memo: note.trim() || undefined,
                    ...parsedOptions,
                  });

                  setNote('');
                  setOpen(false);
                  toast.success(`Transaction proposed. (${signature})`, { id: 'transaction' });
                  await Promise.all([
                    queryClient.invalidateQueries({ queryKey: ['transactions'] }),
                    queryClient.invalidateQueries({ queryKey: ['multisig', multisigAddress] }),
                  ]);
                  navigate('/transactions');
                } catch (e) {
                  toast.error(`Failed to propose: ${formatTransactionError(e)}`, {
                    id: 'transaction',
                  });
                }
              }}
            >
              Import
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Large imported transactions may require multiple wallet approvals: one to create the Squads
          transaction account and one to create the proposal.
        </p>
        <button
          onClick={() => getSampleMessage()}
          disabled={!wallet || !wallet.publicKey}
          className="flex cursor-pointer justify-end text-xs text-stone-400 underline hover:text-stone-200"
        >
          Click to use a sample memo for testing
        </button>
      </DialogContent>
    </Dialog>
  );
};

export default CreateTransaction;
