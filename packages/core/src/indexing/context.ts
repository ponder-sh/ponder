import type { Common } from "@/common/common.js";
import type { Network } from "@/config/networks.js";
import type { Source } from "@/config/sources.js";
import type { IndexingStore, Row } from "@/indexing-store/store.js";
import type { Schema } from "@/schema/types.js";
import type { SyncService } from "@/sync/service.js";
import type { DatabaseModel, StoreMethod } from "@/types/model.js";
import type { Checkpoint } from "@/utils/checkpoint.js";
import {
  type Abi,
  type Address,
  type Client,
  checksumAddress,
  createClient,
} from "viem";
import { mainnet } from "viem/chains";
import { ponderActions } from "./ponderActions.js";

export type Context = {
  network: { chainId: number; name: string };
  client: Client;
  db: Record<string, DatabaseModel<any>>;
  contracts: Record<
    string,
    {
      abi: Abi;
      address?: Address | readonly Address[];
      startBlock: number;
      endBlock?: number;
      maxBlockRange?: number;
    }
  >;
};

export const buildNetwork = ({ networks }: { networks: Network[] }) => {
  const _networks = {} as Record<number, string>;

  for (const network of networks) {
    _networks[network.chain.id] = network.name;
  }

  return (checkpoint: Checkpoint) => ({
    chainId: checkpoint.chainId,
    name: _networks[checkpoint.chainId],
  });
};

export const buildClient =
  ({
    networks,
    syncService,
  }: { networks: Network[]; syncService: SyncService }) =>
  (checkpoint: Checkpoint) => {
    const transport = syncService.getCachedTransport(checkpoint.chainId);
    const chain =
      networks.find((n) => n.chain.id === checkpoint.chainId)?.chain ?? mainnet;

    return createClient({ transport, chain }).extend(
      // Viem doesn't like overriding the readContract function,
      // because other functions may depend on it.
      // @ts-expect-error
      ponderActions(BigInt(checkpoint.blockNumber)),
    ) as Client;
  };

export const buildDb =
  ({
    common,
    indexingStore,
    schema,
  }: {
    common: Common;
    indexingStore: IndexingStore;
    schema: Schema;
  }) =>
  ({
    checkpoint,
    onTableAccess,
  }: {
    checkpoint: Checkpoint;
    onTableAccess: ({
      storeMethod,
      tableName,
    }: { storeMethod: StoreMethod; tableName: string }) => void;
  }) => {
    return Object.keys(schema.tables).reduce<
      Record<string, DatabaseModel<Row>>
    >((acc, tableName) => {
      acc[tableName] = {
        findUnique: async ({ id }) => {
          common.logger.trace({
            service: "store",
            msg: `${tableName}.findUnique(id=${id})`,
          });
          onTableAccess({ storeMethod: "findUnique", tableName });
          return indexingStore.findUnique({
            tableName,
            checkpoint,
            id,
          });
        },
        findMany: async ({ where, orderBy, limit, before, after } = {}) => {
          common.logger.trace({
            service: "store",
            msg: `${tableName}.findMany`,
          });
          onTableAccess({ storeMethod: "findMany", tableName });
          return indexingStore.findMany({
            tableName,
            checkpoint,
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
          onTableAccess({ storeMethod: "create", tableName });
          return indexingStore.create({
            tableName,
            checkpoint,
            id,
            data,
          });
        },
        createMany: async ({ data }) => {
          common.logger.trace({
            service: "store",
            msg: `${tableName}.createMany(count=${data.length})`,
          });
          onTableAccess({ storeMethod: "createMany", tableName });
          return indexingStore.createMany({
            tableName,
            checkpoint,
            data,
          });
        },
        update: async ({ id, data }) => {
          common.logger.trace({
            service: "store",
            msg: `${tableName}.update(id=${id})`,
          });
          onTableAccess({ storeMethod: "update", tableName });
          return indexingStore.update({
            tableName,
            checkpoint,
            id,
            data,
          });
        },
        updateMany: async ({ where, data }) => {
          common.logger.trace({
            service: "store",
            msg: `${tableName}.updateMany`,
          });
          onTableAccess({ storeMethod: "updateMany", tableName });
          return indexingStore.updateMany({
            tableName,
            checkpoint,
            where,
            data,
          });
        },
        upsert: async ({ id, create, update }) => {
          common.logger.trace({
            service: "store",
            msg: `${tableName}.upsert(id=${id})`,
          });
          onTableAccess({ storeMethod: "upsert", tableName });
          return indexingStore.upsert({
            tableName,
            checkpoint,
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
          onTableAccess({ storeMethod: "delete", tableName });
          return indexingStore.delete({
            tableName,
            checkpoint,
            id,
          });
        },
      };
      return acc;
    }, {});
  };

export const buildContracts = ({ sources }: { sources: Source[] }) => {
  const contracts: Record<number, Context["contracts"]> = {};

  for (const source of sources) {
    const address =
      typeof source.criteria.address === "string"
        ? source.criteria.address
        : undefined;

    if (contracts[source.chainId] === undefined) {
      contracts[source.chainId] = {};
    }

    contracts[source.chainId][source.contractName] = {
      abi: source.abi,
      address: address ? checksumAddress(address) : address,
      startBlock: source.startBlock,
      endBlock: source.endBlock,
      maxBlockRange: source.maxBlockRange,
    };
  }

  return (checkpoint: Checkpoint) => contracts[checkpoint.chainId]!;
};
