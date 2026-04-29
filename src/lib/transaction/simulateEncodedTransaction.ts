'use client';
import { toast } from 'sonner';
import { decodeAndDeserialize } from './decodeAndDeserialize';
import { ComputeBudgetProgram, Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { WalletContextState } from '@solana/wallet-adapter-react';
import { getAccountsForSimulation } from './getAccountsForSimulation';

export const simulateEncodedTransaction = async ({
  tx,
  connection,
  wallet,
  additionalLookupTableAddresses = [],
}: {
  tx: string;
  connection: Connection;
  wallet: WalletContextState;
  additionalLookupTableAddresses?: PublicKey[];
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

    message.instructions.unshift(
      ComputeBudgetProgram.setComputeUnitLimit({
        units: 1_400_000,
      })
    );

    const transaction = new VersionedTransaction(
      message.compileToV0Message(addressLookupTableAccounts)
    );

    const keys = await getAccountsForSimulation(
      connection,
      transaction,
      false,
      addressLookupTableAccounts
    );

    const missingAccounts = (
      await Promise.all(
        keys.map(async (key) => {
          const accountInfo = await connection.getAccountInfo(new PublicKey(key));
          return accountInfo ? null : key;
        })
      )
    ).filter(Boolean);

    if (missingAccounts.length) {
      console.error(`Missing accounts on RPC: ${missingAccounts.join(', ')}`);
    }

    toast.loading('Simulating...', {
      id: 'simulation',
    });
    const { value } = await connection.simulateTransaction(transaction, {
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: 'confirmed',
      accounts: {
        encoding: 'base64',
        addresses: keys,
      },
    });

    if (value.err) {
      throw 'Simulation failed';
    }
  } catch (error: unknown) {
    throw new Error(String(error));
  }
};
