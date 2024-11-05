import { getTables } from "@/schema/utils.js";
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
  GetBlockTransactionCountParameters,
  GetBlockTransactionCountReturnType,
  GetCodeParameters,
  GetCodeReturnType,
  GetEnsNameParameters,
  GetEnsNameReturnType,
  GetStorageAtParameters,
  GetStorageAtReturnType,
  GetTransactionReceiptParameters,
  GetTransactionReceiptReturnType,
  MulticallParameters,
  MulticallReturnType,
  PublicRpcSchema,
  ReadContractParameters,
  ReadContractReturnType,
  Transport,
} from "viem";
import {
  getBalance as viemGetBalance,
  getBlockTransactionCount as viemGetBlockTransactionCount,
  getCode as viemGetCode,
  getEnsName as viemGetEnsName,
  getStorageAt as viemGetStorageAt,
  getTransactionReceipt as viemGetTransactionReceipt,
  multicall as viemMulticall,
  readContract as viemReadContract,
} from "viem/actions";
import type { Service, create } from "./service.js";

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
  getTransactionReceipt: (
    args: Omit<GetTransactionReceiptParameters, "blockTag" | "blockNumber"> &
      BlockOptions,
  ) => Promise<GetTransactionReceiptReturnType>;
  getBlockTransactionCount: (
    args: Omit<
      GetBlockTransactionCountParameters,
      "blockTag" | "blockHash" | "blockNumber"
    > &
      BlockOptions,
  ) => Promise<GetBlockTransactionCountReturnType>;
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
    getTransactionReceipt: ({
      cache,
      blockNumber: userBlockNumber,
      ...args
    }: Omit<GetTransactionReceiptParameters, "blockTag" | "blockNumber"> &
      BlockOptions): Promise<GetTransactionReceiptReturnType> =>
      viemGetTransactionReceipt(client, {
        ...args,
        ...(cache === "immutable"
          ? { blockTag: "latest" }
          : { blockNumber: userBlockNumber ?? contextState.blockNumber }),
      }),
    getBlockTransactionCount: async ({
      cache,
      blockNumber: userBlockNumber,
      ...args
    }: Omit<
      GetBlockTransactionCountParameters,
      "blockTag" | "blockHash" | "blockNumber"
    > &
      BlockOptions): Promise<GetBlockTransactionCountReturnType> =>
      viemGetBlockTransactionCount(client, {
        ...args,
        ...(cache === "immutable"
          ? { blockTag: "latest" }
          : { blockNumber: userBlockNumber ?? contextState.blockNumber }),
      }),
  });
};

export const buildDb = ({
  common,
  schema,
  indexingStore,
  contextState,
}: Pick<Parameters<typeof create>[0], "common" | "schema" | "indexingStore"> & {
  contextState: Pick<
    Service["currentEvent"]["contextState"],
    "encodedCheckpoint"
  >;
}) => {
  return Object.keys(getTables(schema)).reduce<
    Service["currentEvent"]["context"]["db"]
  >((acc, tableName) => {
    acc[tableName] = {
      findUnique: async ({ id }) => {
        common.logger.trace({
          service: "store",
          msg: `${tableName}.findUnique(id=${id})`,
        });
        return indexingStore.findUnique({
          tableName,
          id,
        });
      },
      findMany: async ({ where, orderBy, limit, before, after } = {}) => {
        common.logger.trace({
          service: "store",
          msg: `${tableName}.findMany`,
        });
        return indexingStore.findMany({
          tableName,
          where,
          orderBy,
          limit,
          before,
          after,
        });
      },
      create: async ({ id, data }) => {
        common.logger.trace({
          service: "store",
          msg: `${tableName}.create(id=${id})`,
        });
        return indexingStore.create({
          tableName,
          encodedCheckpoint: contextState.encodedCheckpoint,
          id,
          data,
        });
      },
      createMany: async ({ data }) => {
        common.logger.trace({
          service: "store",
          msg: `${tableName}.createMany(count=${data.length})`,
        });
        return indexingStore.createMany({
          tableName,
          encodedCheckpoint: contextState.encodedCheckpoint,
          data,
        });
      },
      update: async ({ id, data }) => {
        common.logger.trace({
          service: "store",
          msg: `${tableName}.update(id=${id})`,
        });
        return indexingStore.update({
          tableName,
          encodedCheckpoint: contextState.encodedCheckpoint,
          id,
          data,
        });
      },
      updateMany: async ({ where, data }) => {
        common.logger.trace({
          service: "store",
          msg: `${tableName}.updateMany`,
        });
        return indexingStore.updateMany({
          tableName,
          encodedCheckpoint: contextState.encodedCheckpoint,
          where,
          data,
        });
      },
      upsert: async ({ id, create, update }) => {
        common.logger.trace({
          service: "store",
          msg: `${tableName}.upsert(id=${id})`,
        });
        return indexingStore.upsert({
          tableName,
          encodedCheckpoint: contextState.encodedCheckpoint,
          id,
          create,
          update,
        });
      },
      delete: async ({ id }) => {
        common.logger.trace({
          service: "store",
          msg: `${tableName}.delete(id=${id})`,
        });
        return indexingStore.delete({
          tableName,
          encodedCheckpoint: contextState.encodedCheckpoint,
          id,
        });
      },
    };
    return acc;
  }, {});
};
