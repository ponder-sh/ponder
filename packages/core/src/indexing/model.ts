import type { IndexingStore, Row } from "@/indexing-store/store.js";
import type { Common } from "@/Ponder.js";
import type { Schema } from "@/schema/types.js";
import type { DatabaseModel } from "@/types/model.js";

export function buildDatabaseModels({
  common,
  indexingStore,
  schema,
  getCurrentEventTimestamp,
}: {
  common: Common;
  indexingStore: IndexingStore;
  schema: Schema;
  getCurrentEventTimestamp: () => number;
}) {
  return Object.keys(schema.tables).reduce<Record<string, DatabaseModel<Row>>>(
    (acc, tableName) => {
      acc[tableName] = {
        findUnique: async ({ id }) => {
          common.logger.trace({
            service: "store",
            msg: `${tableName}.findUnique(id=${id})`,
          });
          return await indexingStore.findUnique({
            tableName,
            timestamp: getCurrentEventTimestamp(),
            id,
          });
        },
        findMany: async ({ where, skip, take, orderBy } = {}) => {
          common.logger.trace({
            service: "store",
            msg: `${tableName}.findMany`,
          });
          return await indexingStore.findMany({
            tableName,
            timestamp: getCurrentEventTimestamp(),
            where,
            skip,
            take,
            orderBy,
          });
        },
        create: async ({ id, data }) => {
          common.logger.trace({
            service: "store",
            msg: `${tableName}.create(id=${id})`,
          });
          return await indexingStore.create({
            tableName,
            timestamp: getCurrentEventTimestamp(),
            id,
            data,
          });
        },
        createMany: async ({ data }) => {
          common.logger.trace({
            service: "store",
            msg: `${tableName}.createMany(count=${data.length})`,
          });
          return await indexingStore.createMany({
            tableName,
            timestamp: getCurrentEventTimestamp(),
            data,
          });
        },
        update: async ({ id, data }) => {
          common.logger.trace({
            service: "store",
            msg: `${tableName}.update(id=${id})`,
          });
          return await indexingStore.update({
            tableName,
            timestamp: getCurrentEventTimestamp(),
            id,
            data,
          });
        },
        updateMany: async ({ where, data }) => {
          common.logger.trace({
            service: "store",
            msg: `${tableName}.updateMany`,
          });
          return await indexingStore.updateMany({
            tableName,
            timestamp: getCurrentEventTimestamp(),
            where,
            data,
          });
        },
        upsert: async ({ id, create, update }) => {
          common.logger.trace({
            service: "store",
            msg: `${tableName}.upsert(id=${id})`,
          });
          return await indexingStore.upsert({
            tableName,
            timestamp: getCurrentEventTimestamp(),
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
          return await indexingStore.delete({
            tableName,
            timestamp: getCurrentEventTimestamp(),
            id,
          });
        },
      };
      return acc;
    },
    {},
  );
}
