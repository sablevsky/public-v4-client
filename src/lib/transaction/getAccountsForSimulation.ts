'use client';
import {
  AddressLookupTableAccount,
  Connection,
  Message,
  PublicKey,
  SystemProgram,
  VersionedMessage,
  VersionedTransaction,
} from '@solana/web3.js';

export async function getAccountsForSimulation(
  connection: Connection,
  tx: VersionedTransaction,
  isLegacy: boolean,
  resolvedLookupTableAccounts?: AddressLookupTableAccount[]
): Promise<string[]> {
  if (isLegacy) {
    return (tx.message as Message)
      .nonProgramIds()
      .map((pubkey) => pubkey.toString())
      .filter((address) => address !== SystemProgram.programId.toBase58());
  } else {
    const addressLookupTableAccounts =
      resolvedLookupTableAccounts ?? (await loadLookupTables(connection, tx.message));

    const { staticAccountKeys, accountKeysFromLookups } = tx.message.getAccountKeys({
      addressLookupTableAccounts,
    });

    const staticAddresses = staticAccountKeys.reduce((acc, k) => {
      if (!k.equals(SystemProgram.programId)) {
        acc.push(k.toString());
      }
      return acc;
    }, [] as string[]);

    const addressesFromLookups = accountKeysFromLookups
      ? accountKeysFromLookups.writable.map((k) => k.toString())
      : [];

    return [...new Set([...staticAddresses, ...addressesFromLookups])];
  }
}

export async function loadLookupTables(
  connection: Connection,
  transactionMessage: VersionedMessage
) {
  return loadLookupTablesByAddress(
    connection,
    transactionMessage.addressTableLookups.map((addressTableLookup) => addressTableLookup.accountKey)
  );
}

export async function loadLookupTablesByAddress(
  connection: Connection,
  addresses: PublicKey[]
): Promise<AddressLookupTableAccount[]> {
  if (!addresses.length) {
    return [];
  }

  const uniqueAddresses = [...new Map(addresses.map((address) => [address.toBase58(), address])).values()];

  return (
    await Promise.all(
      uniqueAddresses.map(async (address) => {
        const { value } = await connection.getAddressLookupTable(address);
        if (!value) {
          throw new Error(`Address lookup table ${address.toBase58()} not found`);
        }

        return value;
      })
    )
  ).filter(Boolean);
}

export function mergeLookupTableAccounts(
  ...groups: AddressLookupTableAccount[][]
): AddressLookupTableAccount[] {
  return [...new Map(groups.flat().map((account) => [account.key.toBase58(), account])).values()];
}
