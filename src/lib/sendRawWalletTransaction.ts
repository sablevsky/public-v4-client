import {
  Connection,
  SendOptions,
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

  return connection.sendRawTransaction(signedTransaction.serialize(), sendOptions);
}
