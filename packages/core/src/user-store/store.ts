import type { Schema } from "@/schema/types";
import { Prettify } from "@/types/utils";

import type { FilterType } from "./utils";

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
  timestamp?: number;
};

type OperatorMap<
  TField extends
    | string
    | bigint
    | number
    | boolean
    | (string | bigint | number | boolean)[]
> = {
  equals?: TField;
  not?: TField;
} & (TField extends any[]
  ? {
      has?: TField[number];
      notHas?: TField[number];
    }
  : {
      in?: TField[];
      notIn?: TField[];
    }) &
  (TField extends string
    ? {
        startsWith?: TField;
        endsWith?: TField;
        notStartsWith?: TField;
        notEndsWith?: TField;
      }
    : {}) &
  (TField extends number | bigint
    ? {
        gt?: TField;
        gte?: TField;
        lt?: TField;
        lte?: TField;
      }
    : {});

export type WhereInput<
  TModel extends {
    [key: string]:
      | string
      | bigint
      | number
      | boolean
      | (string | bigint | number | boolean)[];
  }
> = {
  [FieldName in keyof TModel]?:
    | Prettify<OperatorMap<TModel[FieldName]>>
    | TModel[FieldName];
};

type ExampleModel = {
  id: string;
  counts: number[];
  name: number;
};

type ExampleWhereInput = WhereInput<ExampleModel>;

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
  versionId?: string;

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

  findMany2(options: {
    modelName: string;
    timestamp?: number;
    where?: WhereInput<any>;
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
    data?:
      | Partial<Omit<ModelInstance, "id">>
      | ((args: {
          current: ModelInstance;
        }) => Partial<Omit<ModelInstance, "id">>);
  }): Promise<ModelInstance>;

  upsert(options: {
    modelName: string;
    timestamp: number;
    id: string | number | bigint;
    create?: Omit<ModelInstance, "id">;
    update?:
      | Partial<Omit<ModelInstance, "id">>
      | ((args: {
          current: ModelInstance;
        }) => Partial<Omit<ModelInstance, "id">>);
  }): Promise<ModelInstance>;

  delete(options: {
    modelName: string;
    timestamp: number;
    id: string | number | bigint;
  }): Promise<boolean>;
}
