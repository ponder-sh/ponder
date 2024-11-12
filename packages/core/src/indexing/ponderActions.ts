import type { Prettify } from "@/types/utils.js";
import type {
  Abi,
  Account,
  Chain,
  Client,
  ContractFunctionArgs,
  ContractFunctionName,
  GetBalanceParameters,
  GetBalanceReturnType,
  GetCodeParameters,
  GetCodeReturnType,
  GetEnsNameParameters,
  GetEnsNameReturnType,
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
  getCode as viemGetCode,
  getEnsName as viemGetEnsName,
  getStorageAt as viemGetStorageAt,
  multicall as viemMulticall,
  readContract as viemReadContract,
} from "viem/actions";
import type { Service } from "./service.js";

export type BlockOptions =
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
  getCode: (
    args: Omit<GetCodeParameters, "blockTag" | "blockNumber"> & BlockOptions,
  ) => Promise<GetCodeReturnType>;
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
    const args extends ContractFunctionArgs<abi, "pure" | "view", functionName>,
  >(
    args: Omit<
      ReadContractParameters<abi, functionName, args>,
      "blockTag" | "blockNumber"
    > &
      BlockOptions,
  ) => Promise<ReadContractReturnType<abi, functionName, args>>;
  getEnsName: (
    args: Omit<GetEnsNameParameters, "blockTag" | "blockNumber"> & BlockOptions,
  ) => Promise<GetEnsNameReturnType>;
};

export type ReadOnlyClient<
  transport extends Transport = Transport,
  chain extends Chain | undefined = Chain | undefined,
> = Prettify<
  Client<transport, chain, undefined, PublicRpcSchema, PonderActions>
>;

export const buildCachedActions = (
  contextState: Pick<Service["currentEvent"]["contextState"], "blockNumber">,
) => {
  return <
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
          : { blockNumber: userBlockNumber ?? contextState.blockNumber }),
      }),
    getCode: ({
      cache,
      blockNumber: userBlockNumber,
      ...args
    }: Omit<GetCodeParameters, "blockTag" | "blockNumber"> &
      BlockOptions): Promise<GetCodeReturnType> =>
      viemGetCode(client, {
        ...args,
        ...(cache === "immutable"
          ? { blockTag: "latest" }
          : { blockNumber: userBlockNumber ?? contextState.blockNumber }),
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
          : { blockNumber: userBlockNumber ?? contextState.blockNumber }),
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
          : { blockNumber: userBlockNumber ?? contextState.blockNumber }),
      }),
    // @ts-ignore
    readContract: <
      const abi extends Abi | readonly unknown[],
      functionName extends ContractFunctionName<abi, "pure" | "view">,
      const args extends ContractFunctionArgs<
        abi,
        "pure" | "view",
        functionName
      >,
    >({
      cache,
      blockNumber: userBlockNumber,
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
          : { blockNumber: userBlockNumber ?? contextState.blockNumber }),
      } as ReadContractParameters<abi, functionName, args>),
    getEnsName: ({
      cache,
      blockNumber: userBlockNumber,
      ...args
    }: Omit<GetEnsNameParameters, "blockTag" | "blockNumber"> &
      BlockOptions): Promise<GetEnsNameReturnType> =>
      viemGetEnsName(client, {
        ...args,
        ...(cache === "immutable"
          ? { blockTag: "latest" }
          : { blockNumber: userBlockNumber ?? contextState.blockNumber }),
      }),
  });
};
