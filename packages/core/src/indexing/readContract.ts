import {
  Abi,
  BaseError,
  CallParameters,
  Chain,
  Client,
  decodeFunctionResult,
  DecodeFunctionResultParameters,
  encodeFunctionData,
  EncodeFunctionDataParameters,
  getContractError,
  ReadContractParameters,
  ReadContractReturnType,
  Transport,
} from "viem";
import { call } from "viem/actions";

/**
 * Build a function with the same api as viem's {@link https://viem.sh/docs/contract/readContract.html readContract} function,
 * but caches the results in the event store.
 */
export const buildReadContract =
  ({
    getCurrentBlockNumber,
  }: {
    // eventStore: EventStore;
    getCurrentBlockNumber: () => bigint;
  }) =>
  async <
    TChain extends Chain | undefined,
    TAbi extends Abi | readonly unknown[],
    TFunctionName extends string
  >(
    client: Client<Transport, TChain>,
    {
      abi,
      address,
      args,
      functionName,
      ...callRequest
    }: Omit<
      ReadContractParameters<TAbi, TFunctionName>,
      "blockTag" | "blockNumber"
    >
  ): Promise<ReadContractReturnType<TAbi, TFunctionName>> => {
    const calldata = encodeFunctionData({
      abi,
      args,
      functionName,
    } as unknown as EncodeFunctionDataParameters<TAbi, TFunctionName>);

    // If cache hit
    // If no cache hit
    try {
      const { data } = await call(client, {
        to: address,
        data: calldata,
        blockNumber: getCurrentBlockNumber(),
        ...callRequest,
      } as unknown as CallParameters);

      return decodeFunctionResult({
        abi,
        args,
        functionName,
        data: data || "0x",
      } as unknown as DecodeFunctionResultParameters<TAbi, TFunctionName>) as ReadContractReturnType<
        TAbi,
        TFunctionName
      >;
      // TODO: add `data` to cache
    } catch (err) {
      throw getContractError(err as BaseError, {
        abi: abi as Abi,
        address,
        args,
        docsPath: "/docs/contract/readContract",
        functionName,
      });
    }
  };
