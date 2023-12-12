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
      blockTag?: "ignore";
    },
  ) => Promise<GetBalanceReturnType>;
  getBytecode: (
    args: Omit<GetBytecodeParameters, "blockTag" | "blockNumber"> & {
      blockTag?: "ignore";
    },
  ) => Promise<GetBytecodeReturnType>;
  getStorageAt: (
    args: Omit<GetStorageAtParameters, "blockTag" | "blockNumber"> & {
      blockTag?: "ignore";
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
      blockTag?: "ignore";
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
      blockTag?: "ignore";
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
  (getCurrentBlockNumber: () => bigint) =>
  <
    TTransport extends Transport = Transport,
    TChain extends Chain | undefined = Chain | undefined,
    TAccount extends Account | undefined = Account | undefined,
  >(
    client: Client<TTransport, TChain, TAccount>,
  ): PonderActions => ({
    getBalance: ({
      blockTag,
      ...args
    }: Omit<GetBalanceParameters, "blockTag" | "blockNumber"> & {
      blockTag?: "ignore";
    }): Promise<GetBalanceReturnType> =>
      viemGetBalance(client, {
        ...args,
        ...(blockTag === "ignore"
          ? { blockTag: "latest" }
          : { blockNumber: getCurrentBlockNumber() }),
      }),
    getBytecode: ({
      blockTag,
      ...args
    }: Omit<GetBytecodeParameters, "blockTag" | "blockNumber"> & {
      blockTag?: "ignore";
    }): Promise<GetBytecodeReturnType> =>
      viemGetBytecode(client, {
        ...args,
        ...(blockTag === "ignore"
          ? { blockTag: "latest" }
          : { blockNumber: getCurrentBlockNumber() }),
      }),
    getStorageAt: ({
      blockTag,
      ...args
    }: Omit<GetStorageAtParameters, "blockTag" | "blockNumber"> & {
      blockTag?: "ignore";
    }): Promise<GetStorageAtReturnType> =>
      viemGetStorageAt(client, {
        ...args,
        ...(blockTag === "ignore"
          ? { blockTag: "latest" }
          : { blockNumber: getCurrentBlockNumber() }),
      }),
    multicall: <
      TContracts extends ContractFunctionConfig[],
      TAllowFailure extends boolean = true,
    >({
      blockTag,
      ...args
    }: Omit<
      MulticallParameters<TContracts, TAllowFailure>,
      "blockTag" | "blockNumber"
    > & {
      blockTag?: "ignore";
    }): Promise<MulticallReturnType<TContracts, TAllowFailure>> =>
      viemMulticall(client, {
        ...args,
        ...(blockTag === "ignore"
          ? { blockTag: "latest" }
          : { blockNumber: getCurrentBlockNumber() }),
      }),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    readContract: <
      const TAbi extends Abi | readonly unknown[],
      TFunctionName extends string,
    >({
      blockTag,
      ...args
    }: Omit<
      ReadContractParameters<TAbi, TFunctionName>,
      "blockTag" | "blockNumber"
    > & {
      blockTag?: "ignore";
    }): Promise<ReadContractReturnType<TAbi, TFunctionName>> =>
      viemReadContract(client, {
        ...args,
        ...(blockTag === "ignore"
          ? { blockTag: "latest" }
          : { blockNumber: getCurrentBlockNumber() }),
      } as ReadContractParameters<TAbi, TFunctionName>),
  });
