import type { Schema } from "@/schema/types";

export type EntityFilter = {
  where?: {
    [key: string]:
      | number
      | string
      | number[]
      | string[]
      | true
      | false
      | undefined
      | null;
  };
  first?: number;
  skip?: number;
  orderBy?: string;
  orderDirection?: "asc" | "desc";
};

export type EntityInstance = Record<string, unknown> & {
  id: string | number | bigint;
};

type MaybePromise<T> = T | Promise<T>;

export interface UserStore {
  schema?: Schema;

  load(options: { schema: Schema }): MaybePromise<void>;
  reset(): MaybePromise<void>;
  teardown(): MaybePromise<void>;

  findUniqueEntity(options: {
    entityName: string;
    id: string | number | bigint;
  }): Promise<EntityInstance | null>;

  createEntity(options: {
    entityName: string;
    id: string | number | bigint;
    data: Omit<EntityInstance, "id">;
  }): Promise<EntityInstance>;

  updateEntity(options: {
    entityName: string;
    id: string | number | bigint;
    data: Omit<Partial<EntityInstance>, "id">;
  }): Promise<EntityInstance>;

  upsertEntity(options: {
    entityName: string;
    id: string | number | bigint;
    create: Omit<EntityInstance, "id">;
    update: Omit<Partial<EntityInstance>, "id">;
  }): Promise<EntityInstance>;

  deleteEntity(options: {
    entityName: string;
    id: string | number | bigint;
  }): Promise<boolean>;

  getEntities(options: {
    entityName: string;
    filter?: EntityFilter;
  }): Promise<EntityInstance[]>;
}
