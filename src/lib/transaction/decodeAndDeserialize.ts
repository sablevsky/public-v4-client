'use client';
import * as bs58 from 'bs58';
import * as multisig from '@sqds/multisig';
import {
  AddressLookupTableAccount,
  Connection,
  Message,
  MessageV0,
  PublicKey,
  TransactionMessage,
  VersionedMessage,
} from '@solana/web3.js';
import {
  loadLookupTables,
  loadLookupTablesByAddress,
  mergeLookupTableAccounts,
} from './getAccountsForSimulation';

type ImportedTransactionVersion = number | 'legacy';

interface DecodedTransaction {
  version: ImportedTransactionVersion;
  staticAccountKeys: PublicKey[];
  versionedMessage: VersionedMessage;
}

export interface DeserializedTransaction extends DecodedTransaction {
  message: TransactionMessage;
  accountKeys: PublicKey[];
  addressLookupTableAccounts: AddressLookupTableAccount[];
}

export interface EphemeralSignerDetectionResult {
  ephemeralSigners: number;
  matchedEphemeralSignerIndexes: number[];
}

/**
 * Decodes a base58 encoded transaction message and returns its compiled form.
 * This keeps the raw static account keys around so import UI logic can
 * auto-detect ephemeral signer PDAs without additional RPC calls.
 */
export function decodeTransactionMessage(tx: string): DecodedTransaction {
  if (!tx) {
    throw new Error('Transaction string is required');
  }

  try {
    const messageBytes = bs58.default.decode(tx);
    const version = VersionedMessage.deserializeMessageVersion(messageBytes);

    if (version === 'legacy') {
      const legacyMessage = Message.from(messageBytes);
      const versionedMessage = VersionedMessage.deserialize(new MessageV0(legacyMessage).serialize());

      return {
        version,
        staticAccountKeys: legacyMessage.accountKeys,
        versionedMessage,
      };
    }

    const versionedMessage = VersionedMessage.deserialize(messageBytes);

    return {
      version,
      staticAccountKeys: versionedMessage.staticAccountKeys,
      versionedMessage,
    };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to decode transaction: ${error.message}`);
    }
    throw new Error('Failed to decode transaction: Unknown error');
  }
}

/**
 * Resolves any embedded v0 lookup tables plus caller-specified extra lookup
 * tables, then decompiles the imported message so downstream callers can
 * simulate or wrap the transaction consistently.
 */
export async function decodeAndDeserialize({
  tx,
  connection,
  additionalLookupTableAddresses = [],
}: {
  tx: string;
  connection: Connection;
  additionalLookupTableAddresses?: PublicKey[];
}): Promise<DeserializedTransaction> {
  const decoded = decodeTransactionMessage(tx);

  const embeddedLookupTableAccounts =
    decoded.version === 'legacy' ? [] : await loadLookupTables(connection, decoded.versionedMessage);
  const additionalLookupTableAccounts = await loadLookupTablesByAddress(
    connection,
    additionalLookupTableAddresses
  );
  const addressLookupTableAccounts = mergeLookupTableAccounts(
    embeddedLookupTableAccounts,
    additionalLookupTableAccounts
  );

  const message = TransactionMessage.decompile(decoded.versionedMessage, {
    addressLookupTableAccounts,
  });
  const accountKeys = decoded.versionedMessage
    .getAccountKeys({ addressLookupTableAccounts })
    .keySegments()
    .flat();

  return {
    ...decoded,
    message,
    accountKeys,
    addressLookupTableAccounts,
  };
}

export function parseLookupTableAddresses(input: string): PublicKey[] {
  const normalizedValues = [...new Set(input.split(/[\s,]+/).map((value) => value.trim()))].filter(
    Boolean
  );

  return normalizedValues.map((value) => {
    try {
      return new PublicKey(value);
    } catch (error) {
      throw new Error(`Invalid address lookup table address: ${value}`);
    }
  });
}

export function parseEphemeralSigners(value: string): number {
  if (!value.trim()) {
    return 0;
  }

  const ephemeralSigners = Number(value);
  if (!Number.isInteger(ephemeralSigners) || ephemeralSigners < 0 || ephemeralSigners > 255) {
    throw new Error('Ephemeral signers must be an integer between 0 and 255');
  }

  return ephemeralSigners;
}

export function detectEphemeralSignersForTransaction({
  staticAccountKeys,
  multisigPda,
  transactionIndex,
  programId,
}: {
  staticAccountKeys: PublicKey[];
  multisigPda: PublicKey;
  transactionIndex: bigint;
  programId: PublicKey;
}): EphemeralSignerDetectionResult {
  const staticAccountKeySet = new Set(staticAccountKeys.map((accountKey) => accountKey.toBase58()));
  const [transactionPda] = multisig.getTransactionPda({
    multisigPda,
    index: transactionIndex,
    programId,
  });

  const matchedEphemeralSignerIndexes: number[] = [];

  for (let ephemeralSignerIndex = 0; ephemeralSignerIndex < 255; ephemeralSignerIndex += 1) {
    const [ephemeralSignerPda] = multisig.getEphemeralSignerPda({
      transactionPda,
      ephemeralSignerIndex,
      programId,
    });

    if (staticAccountKeySet.has(ephemeralSignerPda.toBase58())) {
      matchedEphemeralSignerIndexes.push(ephemeralSignerIndex);
    }
  }

  return {
    ephemeralSigners: matchedEphemeralSignerIndexes.length
      ? matchedEphemeralSignerIndexes[matchedEphemeralSignerIndexes.length - 1] + 1
      : 0,
    matchedEphemeralSignerIndexes,
  };
}
