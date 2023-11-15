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
        findUnique: ({ id }) => {
          common.logger.trace({
            service: "store",
            msg: `findUnique (table=${tableName}, id=${id})`,
          });
          return indexingStore.findUnique({
            tableName,
            timestamp: getCurrentEventTimestamp(),
            id,
          });
        },
        findMany: ({ where, skip, take, orderBy } = {}) => {
          common.logger.trace({
            service: "store",
            msg: `findMany (table=${tableName})`,
          });
          return indexingStore.findMany({
            tableName,
            timestamp: getCurrentEventTimestamp(),
            where,
            skip,
            take,
            orderBy,
          });
        },
        create: ({ id, data }) => {
          common.logger.trace({
            service: "store",
            msg: `create (table=${tableName}, id=${id})`,
          });
          return indexingStore.create({
            tableName,
            timestamp: getCurrentEventTimestamp(),
            id,
            data,
          });
        },
        createMany: ({ data }) => {
          common.logger.trace({
            service: "store",
            msg: `createMany (table=${tableName}, count=${data.length})`,
          });
          return indexingStore.createMany({
            tableName,
            timestamp: getCurrentEventTimestamp(),
            data,
          });
        },
        update: ({ id, data }) => {
          common.logger.trace({
            service: "store",
            msg: `update (table=${tableName}, id=${id})`,
          });
          return indexingStore.update({
            tableName,
            timestamp: getCurrentEventTimestamp(),
            id,
            data,
          });
        },
        updateMany: ({ where, data }) => {
          common.logger.trace({
            service: "store",
            msg: `updateMany (table=${tableName})`,
          });
          return indexingStore.updateMany({
            tableName,
            timestamp: getCurrentEventTimestamp(),
            where,
            data,
          });
        },
        upsert: ({ id, create, update }) => {
          common.logger.trace({
            service: "store",
            msg: `upsert (table=${tableName}, id=${id})`,
          });
          return indexingStore.upsert({
            tableName,
            timestamp: getCurrentEventTimestamp(),
            id,
            create,
            update,
          });
        },
        delete: ({ id }) => {
          common.logger.trace({
            service: "store",
            msg: `delete (table=${tableName}, id=${id})`,
          });
          return indexingStore.delete({
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
