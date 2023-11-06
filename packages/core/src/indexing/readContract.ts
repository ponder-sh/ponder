import {
  Abi,
  Chain,
  Client,
  ReadContractParameters,
  ReadContractReturnType,
  Transport,
} from "viem";
import { readContract } from "viem/actions";

/**
 * Build a function with the same api as viem's {@link https://viem.sh/docs/contract/readContract.html readContract} function,
 * but removes `blockTag` and `blockNumber`, overriding `blockNumber`.
 */
export const buildReadContract =
  ({ getCurrentBlockNumber }: { getCurrentBlockNumber: () => bigint }) =>
  async <
    TChain extends Chain | undefined,
    TAbi extends Abi | readonly unknown[],
    TFunctionName extends string
  >(
    client: Client<Transport, TChain>,
    args: Omit<
      ReadContractParameters<TAbi, TFunctionName>,
      "blockTag" | "blockNumber"
    >
  ): Promise<ReadContractReturnType<TAbi, TFunctionName>> => {
    return readContract(client, {
      ...args,
      blockNumber: getCurrentBlockNumber(),
    } as unknown as ReadContractParameters<TAbi, TFunctionName>);
  };
