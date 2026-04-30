'use client';
import * as multisig from '@sqds/multisig';
import {
  AddressLookupTableAccount,
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { decodeAndDeserialize } from './decodeAndDeserialize';
import { WalletContextState } from '@solana/wallet-adapter-react';
import { toast } from 'sonner';
import { waitForConfirmation } from '~/lib/transactionConfirmation';
import { buildProposalIx } from '~/lib/multisigUtils';
import { sendRawWalletTransaction } from '@/lib/sendRawWalletTransaction';

const MAX_TRANSACTION_BUFFER_SIZE = 10_128;
const TRANSACTION_BUFFER_CHUNK_SIZE = 800;
const EMPTY_BUFFER_TRANSACTION_MESSAGE = new Uint8Array([0, 0, 0, 0, 0, 0]);
const SEED_TRANSACTION_BUFFER = new TextEncoder().encode('transaction_buffer');
const SEED_PREFIX = new TextEncoder().encode('multisig');

const sendInstructionTransaction = async ({
  connection,
  wallet,
  instruction,
  statusLabel,
}: {
  connection: Connection;
  wallet: WalletContextState;
  instruction: TransactionInstruction;
  statusLabel: string;
}) => {
  const blockhash = (await connection.getLatestBlockhash()).blockhash;
  const wrappedMessage = new TransactionMessage({
    instructions: [instruction],
    payerKey: wallet.publicKey!,
    recentBlockhash: blockhash,
  }).compileToV0Message();

  const transaction = new VersionedTransaction(wrappedMessage);

  toast.loading(`Waiting for wallet approval: ${statusLabel}...`, {
    id: 'transaction',
    duration: Infinity,
  });

  toast.loading(`Sending transaction: ${statusLabel}...`, {
    id: 'transaction',
    duration: Infinity,
  });

  const signature = await sendRawWalletTransaction(wallet, connection, transaction, {
    skipPreflight: true,
    preflightCommitment: 'confirmed',
  });

  const shortSig = `${signature.slice(0, 8)}...${signature.slice(-4)}`;
  toast.info(`Sent: ${signature}`, { duration: 6000 });
  toast.info(`Confirming: ${shortSig}`, { id: 'transaction', duration: Infinity });

  const [confirmed] = await waitForConfirmation(connection, [signature]);
  if (!confirmed) {
    throw `Transaction failed or timed out. Check ${signature}`;
  }

  return signature;
};

const deriveTransactionBufferPda = ({
  multisigPda,
  creator,
  bufferIndex,
  programId,
}: {
  multisigPda: PublicKey;
  creator: PublicKey;
  bufferIndex: number;
  programId: PublicKey;
}) =>
  PublicKey.findProgramAddressSync(
    [
      SEED_PREFIX,
      multisigPda.toBytes(),
      SEED_TRANSACTION_BUFFER,
      creator.toBytes(),
      Uint8Array.of(bufferIndex),
    ],
    programId
  );

const getNextTransactionBuffer = async ({
  connection,
  multisigPda,
  creator,
  programId,
}: {
  connection: Connection;
  multisigPda: PublicKey;
  creator: PublicKey;
  programId: PublicKey;
}) => {
  for (let bufferIndex = 0; bufferIndex < 256; bufferIndex += 1) {
    const [bufferPda] = deriveTransactionBufferPda({
      multisigPda,
      creator,
      bufferIndex,
      programId,
    });

    const existingAccount = await connection.getAccountInfo(bufferPda);
    if (!existingAccount) {
      return { bufferIndex, bufferPda };
    }
  }

  throw new Error('No available transaction buffer slot for this member.');
};

const chunkBytes = (bytes: Uint8Array, chunkSize: number) => {
  const chunks: Uint8Array[] = [];

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(bytes.slice(offset, offset + chunkSize));
  }

  return chunks;
};

const sha256 = async (bytes: Uint8Array) =>
  new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));

const isTransactionTooLargeError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  return (
    message.includes('encoding overruns Uint8Array') ||
    message.includes('VersionedTransaction too large') ||
    message.includes('Transaction too large') ||
    message.includes('max: encoded/raw')
  );
};

const createBufferedVaultTransaction = async ({
  connection,
  wallet,
  multisigPda,
  transactionIndex,
  vaultIndex,
  ephemeralSigners,
  message,
  addressLookupTableAccounts,
  memo,
  programId,
}: {
  connection: Connection;
  wallet: WalletContextState;
  multisigPda: PublicKey;
  transactionIndex: bigint;
  vaultIndex: number;
  ephemeralSigners: number;
  message: TransactionMessage;
  addressLookupTableAccounts: AddressLookupTableAccount[];
  memo?: string;
  programId: PublicKey;
}) => {
  const [vaultPda] = multisig.getVaultPda({
    multisigPda,
    index: vaultIndex,
    programId,
  });

  const transactionMessageBytes = multisig.utils.transactionMessageToMultisigTransactionMessageBytes({
    message,
    addressLookupTableAccounts,
    vaultPda,
  });

  if (transactionMessageBytes.length > MAX_TRANSACTION_BUFFER_SIZE) {
    throw new Error(
      `Imported transaction message is ${transactionMessageBytes.length} bytes, exceeding Squads buffer limit of ${MAX_TRANSACTION_BUFFER_SIZE} bytes.`
    );
  }

  const messageHash = await sha256(transactionMessageBytes);
  const chunks = chunkBytes(transactionMessageBytes, TRANSACTION_BUFFER_CHUNK_SIZE);
  const { bufferIndex, bufferPda } = await getNextTransactionBuffer({
    connection,
    multisigPda,
    creator: wallet.publicKey!,
    programId,
  });

  const createBufferIx = multisig.generated.createTransactionBufferCreateInstruction(
    {
      multisig: multisigPda,
      transactionBuffer: bufferPda,
      creator: wallet.publicKey!,
      rentPayer: wallet.publicKey!,
    },
    {
      args: {
        bufferIndex,
        vaultIndex,
        finalBufferHash: Array.from(messageHash),
        finalBufferSize: transactionMessageBytes.length,
        buffer: chunks[0] ?? new Uint8Array(),
      },
    },
    programId
  );

  await sendInstructionTransaction({
    connection,
    wallet,
    instruction: createBufferIx,
    statusLabel: `1/${chunks.length + 2} create transaction buffer`,
  });

  for (const [index, chunk] of chunks.slice(1).entries()) {
    const extendBufferIx = multisig.generated.createTransactionBufferExtendInstruction(
      {
        multisig: multisigPda,
        transactionBuffer: bufferPda,
        creator: wallet.publicKey!,
      },
      {
        args: {
          buffer: chunk,
        },
      },
      programId
    );

    await sendInstructionTransaction({
      connection,
      wallet,
      instruction: extendBufferIx,
      statusLabel: `${index + 2}/${chunks.length + 2} extend transaction buffer`,
    });
  }

  const [transactionPda] = multisig.getTransactionPda({
    multisigPda,
    index: transactionIndex,
    programId,
  });

  const createFromBufferIx = multisig.generated.createVaultTransactionCreateFromBufferInstruction(
    {
      vaultTransactionCreateItemMultisig: multisigPda,
      vaultTransactionCreateItemTransaction: transactionPda,
      vaultTransactionCreateItemCreator: wallet.publicKey!,
      vaultTransactionCreateItemRentPayer: wallet.publicKey!,
      vaultTransactionCreateItemSystemProgram: SystemProgram.programId,
      transactionBuffer: bufferPda,
      creator: wallet.publicKey!,
    },
    {
      args: {
        vaultIndex,
        ephemeralSigners,
        transactionMessage: EMPTY_BUFFER_TRANSACTION_MESSAGE,
        memo: memo ?? null,
      },
    },
    programId
  );

  await sendInstructionTransaction({
    connection,
    wallet,
    instruction: createFromBufferIx,
    statusLabel: `${chunks.length + 1}/${chunks.length + 2} create Squads transaction from buffer`,
  });

  return {
    stepCount: chunks.length + 3,
  };
};

export const importTransaction = async ({
  tx,
  connection,
  multisigPda,
  programId,
  vaultIndex,
  wallet,
  ephemeralSigners,
  additionalLookupTableAddresses = [],
  memo,
}: {
  tx: string;
  connection: Connection;
  multisigPda: string;
  programId: string;
  vaultIndex: number;
  wallet: WalletContextState;
  ephemeralSigners: number;
  additionalLookupTableAddresses?: PublicKey[];
  memo?: string;
}) => {
  if (!wallet.publicKey) {
    throw 'Please connect your wallet.';
  }
  try {
    const { message, addressLookupTableAccounts } = await decodeAndDeserialize({
      tx,
      connection,
      additionalLookupTableAddresses,
    });

    const multisigInfo = await multisig.accounts.Multisig.fromAccountAddress(
      connection,
      new PublicKey(multisigPda)
    );

    const transactionMessage = new TransactionMessage(message);

    const transactionIndex = Number(multisigInfo.transactionIndex) + 1;
    const transactionIndexBN = BigInt(transactionIndex);

    const resolvedProgramId = programId ? new PublicKey(programId) : multisig.PROGRAM_ID;
    const proposalIx = buildProposalIx(
      new PublicKey(multisigPda),
      wallet.publicKey,
      transactionIndexBN,
      resolvedProgramId
    );
    let proposalStatusLabel = '2/2 create proposal';

    try {
      const multisigTransactionIx = multisig.instructions.vaultTransactionCreate({
        multisigPda: new PublicKey(multisigPda),
        creator: wallet.publicKey,
        ephemeralSigners,
        transactionMessage: transactionMessage,
        transactionIndex: transactionIndexBN,
        addressLookupTableAccounts,
        memo,
        rentPayer: wallet.publicKey,
        vaultIndex: vaultIndex,
        programId: resolvedProgramId,
      });

      await sendInstructionTransaction({
        connection,
        wallet,
        instruction: multisigTransactionIx,
        statusLabel: '1/2 create Squads transaction',
      });
    } catch (error) {
      if (!isTransactionTooLargeError(error)) {
        throw error;
      }

      const bufferedTransaction = await createBufferedVaultTransaction({
        connection,
        wallet,
        multisigPda: new PublicKey(multisigPda),
        transactionIndex: transactionIndexBN,
        vaultIndex,
        ephemeralSigners,
        message: transactionMessage,
        addressLookupTableAccounts,
        memo,
        programId: resolvedProgramId,
      });

      proposalStatusLabel = `${bufferedTransaction.stepCount}/${bufferedTransaction.stepCount} create proposal`;
    }

    return sendInstructionTransaction({
      connection,
      wallet,
      instruction: proposalIx,
      statusLabel: proposalStatusLabel,
    });
  } catch (error) {
    throw error;
  }
};
