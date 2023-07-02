import { Schema } from "@/schema/types";
import { Model } from "@/types/model";
import { ModelInstance, UserStore } from "@/user-store/store";

export function buildModels({
  userStore,
  schema,
  getCurrentEventTimestamp,
}: {
  userStore: UserStore;
  schema: Schema;
  getCurrentEventTimestamp: () => number;
}) {
  return schema.entities.reduce<Record<string, Model<ModelInstance>>>(
    (acc, { name: modelName }) => {
      acc[modelName] = {
        findUnique: ({ id }) =>
          userStore.findUnique({
            modelName,
            timestamp: getCurrentEventTimestamp(),
            id,
          }),
        create: ({ id, data }) =>
          userStore.create({
            modelName,
            timestamp: getCurrentEventTimestamp(),
            id,
            data,
          }),
        update: ({ id, data }) =>
          userStore.update({
            modelName,
            timestamp: getCurrentEventTimestamp(),
            id,
            data,
          }),
        upsert: ({ id, create, update }) =>
          userStore.upsert({
            modelName,
            timestamp: getCurrentEventTimestamp(),
            id,
            create,
            update,
          }),
        delete: ({ id }) =>
          userStore.delete({
            modelName,
            timestamp: getCurrentEventTimestamp(),
            id,
          }),
      };
      return acc;
    },
    {}
  );
}
