import type { Schema } from "@/schema/types";

import { FilterType } from "./utils";

export type WhereFieldValue =
  | number
  | string
  | number[]
  | string[]
  | true
  | false
  | undefined
  | null;

export type ModelFilter = {
  where?: { [key: `${string}_${FilterType}`]: WhereFieldValue };
  first?: number;
  skip?: number;
  orderBy?: string;
  orderDirection?: "asc" | "desc";
};

export type ModelInstance = {
  id: string | number | bigint;
  [key: string]:
    | string
    | bigint
    | number
    | boolean
    | (string | bigint | number | boolean)[]
    | null;
};

export interface UserStore {
  schema?: Schema;

  reload(options?: { schema?: Schema }): Promise<void>;
  teardown(): Promise<void>;

  revert(options: { safeTimestamp: number }): Promise<void>;

  findUnique(options: {
    modelName: string;
    timestamp?: number;
    id: string | number | bigint;
  }): Promise<ModelInstance | null>;

  findMany(options: {
    modelName: string;
    timestamp?: number;
    filter?: ModelFilter;
  }): Promise<ModelInstance[]>;

  create(options: {
    modelName: string;
    timestamp: number;
    id: string | number | bigint;
    data?: Omit<ModelInstance, "id">;
  }): Promise<ModelInstance>;

  update(options: {
    modelName: string;
    timestamp: number;
    id: string | number | bigint;
    data: Partial<Omit<ModelInstance, "id">>;
  }): Promise<ModelInstance>;

  upsert(options: {
    modelName: string;
    timestamp: number;
    id: string | number | bigint;
    create?: Omit<ModelInstance, "id">;
    update?: Partial<Omit<ModelInstance, "id">>;
  }): Promise<ModelInstance>;

  delete(options: {
    modelName: string;
    timestamp: number;
    id: string | number | bigint;
  }): Promise<boolean>;
}
