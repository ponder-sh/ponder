import {
  Chain,
  Client,
  GetStorageAtParameters,
  GetStorageAtReturnType,
  Transport,
} from "viem";
import { getStorageAt } from "viem/actions";

/**
 * Build a function with the same api as viem's {@link https://viem.sh/docs/contract/getStorageAt.html getStorageAt} function,
 * but removes `blockTag` and `blockNumber`, overriding `blockNumber`.
 */
export const buildGetStorageAt =
  ({ getCurrentBlockNumber }: { getCurrentBlockNumber: () => bigint }) =>
  async <TChain extends Chain | undefined>(
    client: Client<Transport, TChain>,
    args: Omit<GetStorageAtParameters, "blockTag" | "blockNumber">
  ): Promise<GetStorageAtReturnType> => {
    return getStorageAt(client, {
      ...args,
      blockNumber: getCurrentBlockNumber(),
    });
  };
