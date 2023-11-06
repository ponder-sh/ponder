import {
  Chain,
  Client,
  GetBytecodeParameters,
  GetBytecodeReturnType,
  Transport,
} from "viem";
import { getBytecode } from "viem/actions";

/**
 * Build a function with the same api as viem's {@link https://viem.sh/docs/contract/getBytecode.html getBytecode} function,
 * but removes `blockTag` and `blockNumber`, overriding `blockNumber`.
 */
export const buildGetBytecode =
  ({ getCurrentBlockNumber }: { getCurrentBlockNumber: () => bigint }) =>
  async <TChain extends Chain | undefined>(
    client: Client<Transport, TChain>,
    args: Omit<GetBytecodeParameters, "blockTag" | "blockNumber">
  ): Promise<GetBytecodeReturnType> => {
    return getBytecode(client, {
      ...args,
      blockNumber: getCurrentBlockNumber(),
    });
  };
