import type { IndexingStore, Row } from "@/indexing-store/store.js";
import type { Common } from "@/Ponder.js";
import type { Schema } from "@/schema/types.js";
import type { DatabaseModel } from "@/types/model.js";
import type { IndexingCheckpoint } from "@/utils/checkpoint.js";

export function buildDatabaseModels({
  common,
  indexingStore,
  schema,
  getCurrentIndexingCheckpoint,
}: {
  common: Common;
  indexingStore: IndexingStore;
  schema: Schema;
  getCurrentIndexingCheckpoint: () => IndexingCheckpoint;
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
            checkpoint: getCurrentIndexingCheckpoint(),
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
            checkpoint: getCurrentIndexingCheckpoint(),
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
            checkpoint: getCurrentIndexingCheckpoint(),
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
            checkpoint: getCurrentIndexingCheckpoint(),
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
            checkpoint: getCurrentIndexingCheckpoint(),
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
            checkpoint: getCurrentIndexingCheckpoint(),
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
            checkpoint: getCurrentIndexingCheckpoint(),
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
            checkpoint: getCurrentIndexingCheckpoint(),
            id,
          });
        },
      };
      return acc;
    },
    {},
  );
}
