import { AbiParameter } from "abitype";
import { BlockTag, encodeFunctionData } from "viem";

import { Contract } from "@/config/contracts";

import { EventHandlerService } from "./service";

export type ReadOnlyContract = {
  [key: string]: (...args: any[]) => Promise<any>;
};

type AbiReadFunction = {
  type: "function";
  stateMutability: "pure" | "view";
  inputs: readonly AbiParameter[];
  name: string;
  outputs: readonly AbiParameter[];
};

type CallOverrides =
  | {
      /** The block number at which to execute the contract call. */
      blockNumber?: bigint;
      blockTag?: never;
    }
  | {
      blockNumber?: never;
      /** The block tag at which to execute the contract call. */
      blockTag?: BlockTag;
    };

export function buildInjectedContract({
  contract,
  eventHandlerService,
}: {
  contract: Contract;
  eventHandlerService: EventHandlerService;
}) {
  const injectedContract: ReadOnlyContract = {};

  const readFunctions = contract.abi.filter(
    (item): item is AbiReadFunction =>
      item.type === "function" &&
      (item.stateMutability === "pure" || item.stateMutability === "view")
  );

  readFunctions.forEach((readFunction) => {
    injectedContract[readFunction.name] = async (...args) => {
      let overrides: CallOverrides;

      // If the length of the args is one greater than the length of the inputs,
      // an overrides argument was provided.
      if (args.length === readFunction.inputs.length + 1) {
        overrides = args.pop();
      } else {
        overrides = {
          blockNumber: eventHandlerService.currentLogEventBlockNumber,
        };
      }

      // If `overrides` uses a blockNumber (either provided by the user or using the)
      // default of currentLogEventBlockNumber, enable caching.
      const isCachingEnabled = overrides.blockNumber !== undefined;

      let result: any;

      if (!isCachingEnabled) {
        result = await contract.network.client.readContract({
          address: contract.address,
          abi: contract.abi,
          functionName: readFunction.name as never,
          args: args,
          ...overrides,
        });
      }

      if (isCachingEnabled) {
        const calldata = encodeFunctionData({
          abi: contract.abi,
          args: args,
          functionName: readFunction.name as never,
        });

        const contractCallCacheKey = `${contract.network.chainId}-${overrides.blockNumber}-${contract.address}-${calldata}`;

        const cachedContractCall =
          await eventHandlerService.eventStore.getContractCall(
            contractCallCacheKey
          );

        if (cachedContractCall) {
          result = JSON.parse(cachedContractCall.result, reviveJsonBigInt);
        } else {
          result = await contract.network.client.readContract({
            address: contract.address,
            abi: contract.abi,
            functionName: readFunction.name as never,
            args: args,
          });

          await eventHandlerService.eventStore.insertContractCall({
            key: contractCallCacheKey,
            result: JSON.stringify(result, serializeJsonBigInt),
          });
        }
      }

      let resultObject: any;
      if (readFunction.outputs.length > 1) {
        resultObject = {} as Record<string, any>;
        readFunction.outputs.forEach((output, index) => {
          const propertyName = output.name ? output.name : `arg_${index}`;
          resultObject[propertyName] = (result as any[])[index];
        });
      } else {
        resultObject = result;
      }

      return resultObject;
    };
  });

  return injectedContract;
}

function reviveJsonBigInt(_: string, value: any) {
  if (typeof value?.__bigint__ === "string") {
    return BigInt(value.__bigint__);
  }
  return value;
}

function serializeJsonBigInt(_: string, value: any) {
  if (typeof value === "bigint") {
    return { __bigint__: value.toString() };
  }
  return value;
}
