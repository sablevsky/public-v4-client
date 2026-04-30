import {
  Connection,
  SendOptions,
  SendTransactionError,
  Signer,
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js';
import { WalletContextState } from '@solana/wallet-adapter-react';

type WalletTransaction = Transaction | VersionedTransaction;
type SendRawWalletTransactionOptions = SendOptions & {
  signers?: Signer[];
};

export async function sendRawWalletTransaction(
  wallet: WalletContextState,
  connection: Connection,
  transaction: WalletTransaction,
  options?: SendRawWalletTransactionOptions
) {
  if (!wallet.publicKey) {
    throw 'Please connect your wallet.';
  }

  if (!wallet.signTransaction) {
    throw 'Connected wallet does not support transaction signing.';
  }

  if (transaction instanceof Transaction) {
    transaction.feePayer = transaction.feePayer ?? wallet.publicKey;
    transaction.recentBlockhash =
      transaction.recentBlockhash ?? (await connection.getLatestBlockhash()).blockhash;
    if (options?.signers?.length) {
      transaction.partialSign(...options.signers);
    }
  } else if (options?.signers?.length) {
    transaction.sign(options.signers);
  }

  const signedTransaction = await wallet.signTransaction(transaction);

  const { signers, ...sendOptions } = options ?? {};

  try {
    return await connection.sendRawTransaction(signedTransaction.serialize(), sendOptions);
  } catch (error) {
    if (error instanceof SendTransactionError) {
      try {
        const logs = await error.getLogs(connection);
        if (logs.length) {
          error.message = `${error.message}\nLogs:\n${logs.join('\n')}`;
        }
      } catch {
        // Some send errors, such as size-limit failures, do not have retrievable logs.
      }
    }

    throw error;
  }
}
