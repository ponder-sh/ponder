import type { IndexingStore, ModelInstance } from "@/indexing-store/store";
import type { Common } from "@/Ponder";
import type { Schema } from "@/schema/types";
import type { Model } from "@/types/model";

export function buildModels({
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
  return Object.keys(schema.tables).reduce<
    Record<string, Model<ModelInstance>>
  >((acc, modelName) => {
    acc[modelName] = {
      findUnique: ({ id }) => {
        common.logger.trace({
          service: "store",
          msg: `findUnique (model=${modelName}, id=${id})`,
        });
        return indexingStore.findUnique({
          modelName,
          timestamp: getCurrentEventTimestamp(),
          id,
        });
      },
      findMany: ({ where, skip, take, orderBy } = {}) => {
        common.logger.trace({
          service: "store",
          msg: `findMany (model=${modelName})`,
        });
        return indexingStore.findMany({
          modelName,
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
          msg: `create (model=${modelName}, id=${id})`,
        });
        return indexingStore.create({
          modelName,
          timestamp: getCurrentEventTimestamp(),
          id,
          data,
        });
      },
      createMany: ({ data }) => {
        common.logger.trace({
          service: "store",
          msg: `createMany (model=${modelName}, count=${data.length})`,
        });
        return indexingStore.createMany({
          modelName,
          timestamp: getCurrentEventTimestamp(),
          data,
        });
      },
      update: ({ id, data }) => {
        common.logger.trace({
          service: "store",
          msg: `update (model=${modelName}, id=${id})`,
        });
        return indexingStore.update({
          modelName,
          timestamp: getCurrentEventTimestamp(),
          id,
          data,
        });
      },
      updateMany: ({ where, data }) => {
        common.logger.trace({
          service: "store",
          msg: `updateMany (model=${modelName})`,
        });
        return indexingStore.updateMany({
          modelName,
          timestamp: getCurrentEventTimestamp(),
          where,
          data,
        });
      },
      upsert: ({ id, create, update }) => {
        common.logger.trace({
          service: "store",
          msg: `upsert (model=${modelName}, id=${id})`,
        });
        return indexingStore.upsert({
          modelName,
          timestamp: getCurrentEventTimestamp(),
          id,
          create,
          update,
        });
      },
      delete: ({ id }) => {
        common.logger.trace({
          service: "store",
          msg: `delete (model=${modelName}, id=${id})`,
        });
        return indexingStore.delete({
          modelName,
          timestamp: getCurrentEventTimestamp(),
          id,
        });
      },
    };
    return acc;
  }, {});
}
