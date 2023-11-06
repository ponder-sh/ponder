import {
  Chain,
  Client,
  GetBalanceParameters,
  GetBalanceReturnType,
  Transport,
} from "viem";
import { getBalance } from "viem/actions";

/**
 * Build a function with the same api as viem's {@link https://viem.sh/docs/actions/public/getBalance.html getBalance} function,
 * but removes `blockTag` and `blockNumber`, overriding `blockNumber`.
 */
export const buildGetBalance =
  ({ getCurrentBlockNumber }: { getCurrentBlockNumber: () => bigint }) =>
  async <TChain extends Chain | undefined>(
    client: Client<Transport, TChain>,
    args: Omit<GetBalanceParameters, "blockTag" | "blockNumber">
  ): Promise<GetBalanceReturnType> => {
    return getBalance(client, {
      ...args,
      blockNumber: getCurrentBlockNumber(),
    });
  };
