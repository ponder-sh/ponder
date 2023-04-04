import { Abi, AbiParameter } from "abitype";
import {
  BlockTag,
  createPublicClient,
  custom,
  encodeFunctionData,
  getContract,
  GetContractReturnType,
  http,
  PublicClient,
  TransactionRequest,
} from "viem";

import { Contract } from "@/config/contracts";

import { EventHandlerService } from "./EventHandlerService";

export type ReadOnlyContract<TAbi extends readonly unknown[] | Abi = Abi> =
  // eslint-disable-next-line @typescript-eslint/ban-types
  Pick<GetContractReturnType<TAbi, PublicClient> & { read: {} }, "read">;

// {
//   method: 'eth_call',
//   params: [
//     {
//       from: undefined,
//       accessList: undefined,
//       data: '0x35fae7a60000000000000000000000009746fd0a77829e12f8a9dbe70d7a322412325b910000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000001667756e7a6970536372697074732d302e302e312e6a7300000000000000000000',
//       gas: undefined,
//       gasPrice: undefined,
//       maxFeePerGas: undefined,
//       maxPriorityFeePerGas: undefined,
//       nonce: undefined,
//       to: '0xbc66c61bcf49cc3fe4e321aecea307f61ec57c0b',
//       value: undefined
//     },
//     'latest'
//   ]
// }

export function buildInjectedContract({
  contract,
  eventHandlerService,
}: {
  contract: Contract;
  eventHandlerService: EventHandlerService;
}): ReadOnlyContract {
  const httpTransport = http(contract.network.rpcUrl)({});

  const cachedTransport = custom({
    async request({
      method,
      params,
    }: {
      method: "eth_call";
      params: [request: TransactionRequest, blockTag: BlockTag];
    }) {
      if (method !== "eth_call") {
        eventHandlerService.resources.logger.warn(
          "Unexpected RPC request in cachedTransport. Expected eth_call, received:",
          { method, params }
        );
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        return httpTransport.request({ method, params });
      }

      console.log({ method, params });

      const [request, blockTag] = params;
      console.log({ request, blockTag });

      // // If the length of the args is one greater than the length of the inputs,
      // // an overrides argument was provided.
      // if (args.length === readFunction.inputs.length + 1) {
      //   overrides = args.pop();
      // } else {
      //   overrides = {
      //     blockNumber: eventHandlerService.currentLogEventBlockNumber,
      //   };
      // }

      // If `overrides` uses a blockNumber (either provided by the user or using the)
      // default of currentLogEventBlockNumber, enable caching.
      const isCachingEnabled = typeof blockTag === "number";
      console.log({ isCachingEnabled });

      let result: any;

      if (!isCachingEnabled) {
        return httpTransport.request({ method, params });
      }

      if (isCachingEnabled) {
        const calldata = request.data;
        const contractCallCacheKey = `${contract.network.chainId}-${overrides.blockNumber}-${contract.address}-${request.data}`;

        const cachedContractCall =
          await eventHandlerService.resources.cacheStore.getContractCall(
            contractCallCacheKey
          );

        if (cachedContractCall) {
          result = JSON.parse(cachedContractCall.result, reviveJsonBigInt);
        } else {
          result = httpTransport.request({
            method,
            params: [request, blockTag],
          });

          await eventHandlerService.resources.cacheStore.upsertContractCall({
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
    },
  });

  const injectedContract = getContract({
    abi: contract.abi,
    address: contract.address,
    publicClient: createPublicClient({
      transport: cachedTransport,
    }),
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
