import type {
  Abi,
  Account,
  Chain,
  Client,
  ContractFunctionConfig,
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

export type PonderActions = {
  getBalance: (
    args: Omit<GetBalanceParameters, "blockTag" | "blockNumber"> & {
      cache?: "immutable";
    },
  ) => Promise<GetBalanceReturnType>;
  getBytecode: (
    args: Omit<GetBytecodeParameters, "blockTag" | "blockNumber"> & {
      cache?: "immutable";
    },
  ) => Promise<GetBytecodeReturnType>;
  getStorageAt: (
    args: Omit<GetStorageAtParameters, "blockTag" | "blockNumber"> & {
      cache?: "immutable";
    },
  ) => Promise<GetStorageAtReturnType>;
  multicall: <
    TContracts extends ContractFunctionConfig[],
    TAllowFailure extends boolean = true,
  >(
    args: Omit<
      MulticallParameters<TContracts, TAllowFailure>,
      "blockTag" | "blockNumber"
    > & {
      cache?: "immutable";
    },
  ) => Promise<MulticallReturnType<TContracts, TAllowFailure>>;
  readContract: <
    const TAbi extends Abi | readonly unknown[],
    TFunctionName extends string,
  >(
    args: Omit<
      ReadContractParameters<TAbi, TFunctionName>,
      "blockTag" | "blockNumber"
    > & {
      cache?: "immutable";
    },
  ) => Promise<ReadContractReturnType<TAbi, TFunctionName>>;
};

export type ReadOnlyClient<
  transport extends Transport = Transport,
  chain extends Chain | undefined = Chain | undefined,
> = Prettify<
  Client<transport, chain, undefined, PublicRpcSchema, PonderActions>
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
      ...args
    }: Omit<GetBalanceParameters, "blockTag" | "blockNumber"> & {
      cache?: "immutable";
    }): Promise<GetBalanceReturnType> =>
      viemGetBalance(client, {
        ...args,
        ...(cache === "immutable" ? { blockTag: "latest" } : { blockNumber }),
      }),
    getBytecode: ({
      cache,
      ...args
    }: Omit<GetBytecodeParameters, "blockTag" | "blockNumber"> & {
      cache?: "immutable";
    }): Promise<GetBytecodeReturnType> =>
      viemGetBytecode(client, {
        ...args,
        ...(cache === "immutable" ? { blockTag: "latest" } : { blockNumber }),
      }),
    getStorageAt: ({
      cache,
      ...args
    }: Omit<GetStorageAtParameters, "blockTag" | "blockNumber"> & {
      cache?: "immutable";
    }): Promise<GetStorageAtReturnType> =>
      viemGetStorageAt(client, {
        ...args,
        ...(cache === "immutable" ? { blockTag: "latest" } : { blockNumber }),
      }),
    multicall: <
      TContracts extends ContractFunctionConfig[],
      TAllowFailure extends boolean = true,
    >({
      cache,
      ...args
    }: Omit<
      MulticallParameters<TContracts, TAllowFailure>,
      "blockTag" | "blockNumber"
    > & {
      cache?: "immutable";
    }): Promise<MulticallReturnType<TContracts, TAllowFailure>> =>
      viemMulticall(client, {
        ...args,
        ...(cache === "immutable" ? { blockTag: "latest" } : { blockNumber }),
      }),
    // @ts-ignore
    readContract: <
      const TAbi extends Abi | readonly unknown[],
      TFunctionName extends string,
    >({
      cache,
      ...args
    }: Omit<
      ReadContractParameters<TAbi, TFunctionName>,
      "blockTag" | "blockNumber"
    > & {
      cache?: "immutable";
    }): Promise<ReadContractReturnType<TAbi, TFunctionName>> =>
      viemReadContract(client, {
        ...args,
        ...(cache === "immutable" ? { blockTag: "latest" } : { blockNumber }),
      } as ReadContractParameters<TAbi, TFunctionName>),
  });
