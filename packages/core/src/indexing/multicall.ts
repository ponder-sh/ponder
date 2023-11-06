import {
  Chain,
  Client,
  ContractFunctionConfig,
  MulticallParameters,
  MulticallReturnType,
  Transport,
} from "viem";
import { multicall } from "viem/actions";

/**
 * Build a function with the same api as viem's {@link https://viem.sh/docs/contract/multicall.html multicall} function,
 * but removes `blockTag` and `blockNumber`, overriding `blockNumber`.
 */
export const buildMulticall =
  ({ getCurrentBlockNumber }: { getCurrentBlockNumber: () => bigint }) =>
  async <
    TChain extends Chain | undefined,
    TContracts extends ContractFunctionConfig[],
    TAllowFailure extends boolean = true
  >(
    client: Client<Transport, TChain>,
    args: Omit<
      MulticallParameters<TContracts, TAllowFailure>,
      "blockTag" | "blockNumber"
    >
  ): Promise<MulticallReturnType<TContracts, TAllowFailure>> => {
    return multicall(client, {
      ...args,
      blockNumber: getCurrentBlockNumber(),
    });
  };
