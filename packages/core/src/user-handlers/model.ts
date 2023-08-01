import type { Common } from "@/Ponder";
import type { Schema } from "@/schema/types";
import type { Model } from "@/types/model";
import type { ModelInstance, UserStore } from "@/user-store/store";

export function buildModels({
  common,
  userStore,
  schema,
  getCurrentEventTimestamp,
}: {
  common: Common;
  userStore: UserStore;
  schema: Schema;
  getCurrentEventTimestamp: () => number;
}) {
  return schema.entities.reduce<Record<string, Model<ModelInstance>>>(
    (acc, { name: modelName }) => {
      acc[modelName] = {
        findUnique: ({ id }) => {
          common.logger.trace({
            service: "store",
            msg: `findUnique (model=${modelName}, id=${id})`,
          });
          return userStore.findUnique({
            modelName,
            timestamp: getCurrentEventTimestamp(),
            id,
          });
        },
        create: ({ id, data }) => {
          common.logger.trace({
            service: "store",
            msg: `create (model=${modelName}, id=${id})`,
          });
          return userStore.create({
            modelName,
            timestamp: getCurrentEventTimestamp(),
            id,
            data,
          });
        },
        update: ({ id, data }) => {
          common.logger.trace({
            service: "store",
            msg: `update (model=${modelName}, id=${id})`,
          });
          return userStore.update({
            modelName,
            timestamp: getCurrentEventTimestamp(),
            id,
            data,
          });
        },
        upsert: ({ id, create, update }) => {
          common.logger.trace({
            service: "store",
            msg: `upsert (model=${modelName}, id=${id})`,
          });
          return userStore.upsert({
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
          return userStore.delete({
            modelName,
            timestamp: getCurrentEventTimestamp(),
            id,
          });
        },
      };
      return acc;
    },
    {}
  );
}
