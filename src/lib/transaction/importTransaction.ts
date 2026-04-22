'use client';
import * as multisig from '@sqds/multisig';
import {
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { decodeAndDeserialize } from './decodeAndDeserialize';
import { WalletContextState } from '@solana/wallet-adapter-react';
import { toast } from 'sonner';
import { waitForConfirmation } from '~/lib/transactionConfirmation';
import { buildProposalIx } from '~/lib/multisigUtils';

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
    const proposalIx = buildProposalIx(
      new PublicKey(multisigPda),
      wallet.publicKey,
      transactionIndexBN,
      resolvedProgramId
    );

    const blockhash = (await connection.getLatestBlockhash()).blockhash;

    const wrappedMessage = new TransactionMessage({
      instructions: [multisigTransactionIx, proposalIx],
      payerKey: wallet.publicKey,
      recentBlockhash: blockhash,
    }).compileToV0Message();

    const transaction = new VersionedTransaction(wrappedMessage);

    toast.loading('Waiting for wallet approval...', { id: 'transaction', duration: Infinity });

    const signature = await wallet.sendTransaction(transaction, connection, {
      skipPreflight: true,
    });

    const shortSig = `${signature.slice(0, 8)}...${signature.slice(-4)}`;
    toast.info(`Sent: ${signature}`, { duration: 6000 });
    toast.info(`Confirming: ${shortSig}`, { id: 'transaction', duration: Infinity });

    const [confirmed] = await waitForConfirmation(connection, [signature]);
    if (!confirmed) {
      throw `Transaction failed or timed out. Check ${signature}`;
    }
    return signature;
  } catch (error) {
    throw error;
  }
};
