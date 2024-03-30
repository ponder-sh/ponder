import type {
  Abi,
  Account,
  Chain,
  Client,
  ContractFunctionArgs,
  ContractFunctionName,
  GetBalanceParameters,
  GetBalanceReturnType,
  GetBytecodeParameters,
  GetBytecodeReturnType,
  GetStorageAtParameters,
  GetStorageAtReturnType,
  MulticallParameters,
  MulticallReturnType,
  PublicRpcSchema,
  ReadContractParameters,
  ReadContractReturnType,
  Transport,
} from "viem";
import {
  getBalance as viemGetBalance,
  getBytecode as viemGetBytecode,
  getStorageAt as viemGetStorageAt,
  multicall as viemMulticall,
  readContract as viemReadContract,
} from "viem/actions";

import type { Prettify } from "@/types/utils.js";

type BlockOptions =
  | {
      cache?: undefined;
      blockNumber?: undefined;
    }
  | {
      cache: "immutable";
      blockNumber?: undefined;
    }
  | {
      cache?: undefined;
      blockNumber: bigint;
    };

export type PonderActions = {
  getBalance: (
    args: Omit<GetBalanceParameters, "blockTag" | "blockNumber"> & BlockOptions,
  ) => Promise<GetBalanceReturnType>;
  getBytecode: (
    args: Omit<GetBytecodeParameters, "blockTag" | "blockNumber"> &
      BlockOptions,
  ) => Promise<GetBytecodeReturnType>;
  getStorageAt: (
    args: Omit<GetStorageAtParameters, "blockTag" | "blockNumber"> &
      BlockOptions,
  ) => Promise<GetStorageAtReturnType>;
  multicall: <
    const contracts extends readonly unknown[],
    allowFailure extends boolean = true,
  >(
    args: Omit<
      MulticallParameters<contracts, allowFailure>,
      "blockTag" | "blockNumber"
    > &
      BlockOptions,
  ) => Promise<MulticallReturnType<contracts, allowFailure>>;
  readContract: <
    const abi extends Abi | readonly unknown[],
    functionName extends ContractFunctionName<abi, "pure" | "view">,
    args extends ContractFunctionArgs<abi, "pure" | "view", functionName>,
  >(
    // biome-ignore lint/suspicious/noRedeclare: no
    args: Omit<
      ReadContractParameters<abi, functionName, args>,
      "blockTag" | "blockNumber"
    > &
      BlockOptions,
  ) => Promise<ReadContractReturnType<abi, functionName, args>>;
};

export type ReadOnlyClient = Prettify<
  Omit<
    Client<Transport, undefined, undefined, PublicRpcSchema, PonderActions>,
    | "extend"
    | "key"
    | "batch"
    | "cacheTime"
    | "account"
    | "type"
    | "uid"
    | "chain"
    | "name"
    | "pollingInterval"
    | "transport"
    | "ccipRead"
  >
>;

export const ponderActions =
  (blockNumber: bigint) =>
  <
    TTransport extends Transport = Transport,
    TChain extends Chain | undefined = Chain | undefined,
    TAccount extends Account | undefined = Account | undefined,
  >(
    client: Client<TTransport, TChain, TAccount>,
  ): PonderActions => ({
    getBalance: ({
      cache,
      blockNumber: userBlockNumber,
      ...args
    }: Omit<GetBalanceParameters, "blockTag" | "blockNumber"> &
      BlockOptions): Promise<GetBalanceReturnType> =>
      viemGetBalance(client, {
        ...args,
        ...(cache === "immutable"
          ? { blockTag: "latest" }
          : { blockNumber: userBlockNumber ?? blockNumber }),
      }),
    getBytecode: ({
      cache,
      blockNumber: userBlockNumber,
      ...args
    }: Omit<GetBytecodeParameters, "blockTag" | "blockNumber"> &
      BlockOptions): Promise<GetBytecodeReturnType> =>
      viemGetBytecode(client, {
        ...args,
        ...(cache === "immutable"
          ? { blockTag: "latest" }
          : { blockNumber: userBlockNumber ?? blockNumber }),
      }),
    getStorageAt: ({
      cache,
      blockNumber: userBlockNumber,
      ...args
    }: Omit<GetStorageAtParameters, "blockTag" | "blockNumber"> &
      BlockOptions): Promise<GetStorageAtReturnType> =>
      viemGetStorageAt(client, {
        ...args,
        ...(cache === "immutable"
          ? { blockTag: "latest" }
          : { blockNumber: userBlockNumber ?? blockNumber }),
      }),
    multicall: <
      const contracts extends readonly unknown[],
      allowFailure extends boolean = true,
    >({
      cache,
      blockNumber: userBlockNumber,
      ...args
    }: Omit<
      MulticallParameters<contracts, allowFailure>,
      "blockTag" | "blockNumber"
    > &
      BlockOptions): Promise<MulticallReturnType<contracts, allowFailure>> =>
      viemMulticall(client, {
        ...args,
        ...(cache === "immutable"
          ? { blockTag: "latest" }
          : { blockNumber: userBlockNumber ?? blockNumber }),
      }),
    readContract: <
      const abi extends Abi | readonly unknown[],
      functionName extends ContractFunctionName<abi, "pure" | "view">,
      args extends ContractFunctionArgs<abi, "pure" | "view", functionName>,
    >({
      cache,
      blockNumber: userBlockNumber,
      // biome-ignore lint/suspicious/noRedeclare: no
      ...args
    }: Omit<
      ReadContractParameters<abi, functionName, args>,
      "blockTag" | "blockNumber"
    > &
      BlockOptions): Promise<ReadContractReturnType<abi, functionName, args>> =>
      viemReadContract(client, {
        ...args,
        ...(cache === "immutable"
          ? { blockTag: "latest" }
          : { blockNumber: userBlockNumber ?? blockNumber }),
      } as ReadContractParameters<abi, functionName, args>),
  });
