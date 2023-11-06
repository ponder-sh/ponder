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

import { EventStore } from "@/event-store/store";

/**
 * Build a function with the same api as viem's {@link https://viem.sh/docs/contract/readContract.html readContract} function,
 * but caches the results in the event store.
 *
 * @todo How to determine chainID
 */
export const buildReadContract =
  ({
    eventStore,
    getCurrentBlockNumber,
  }: {
    eventStore: EventStore;
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
    const blockNumber = getCurrentBlockNumber();
    const chainId = client.chain!.id;

    // Check cache
    const cachedContractReadResult = await eventStore.getContractReadResult({
      address,
      blockNumber,
      chainId,
      data: calldata,
    });

    if (cachedContractReadResult) {
      // Cache hit
      try {
        return decodeFunctionResult({
          abi,
          args,
          functionName,
          data: cachedContractReadResult.result,
        } as unknown as DecodeFunctionResultParameters<TAbi, TFunctionName>) as ReadContractReturnType<
          TAbi,
          TFunctionName
        >;
      } catch (err) {
        throw getContractError(err as BaseError, {
          abi: abi as Abi,
          address,
          args,
          docsPath: "/docs/contract/readContract",
          functionName,
        });
      }
    } else {
      // No cache hit
      try {
        const { data: rawResult } = await call(client, {
          to: address,
          data: calldata,
          blockNumber,
          ...callRequest,
        } as unknown as CallParameters);

        await eventStore.insertContractReadResult({
          address,
          blockNumber,
          chainId,
          data: calldata,
          result: rawResult || "0x",
        });

        return decodeFunctionResult({
          abi,
          args,
          functionName,
          data: rawResult || "0x",
        } as unknown as DecodeFunctionResultParameters<TAbi, TFunctionName>) as ReadContractReturnType<
          TAbi,
          TFunctionName
        >;
      } catch (err) {
        throw getContractError(err as BaseError, {
          abi: abi as Abi,
          address,
          args,
          docsPath: "/docs/contract/readContract",
          functionName,
        });
      }
    }
  };
