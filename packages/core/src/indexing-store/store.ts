import type { Schema } from "@/schema/types.js";
import type { Prettify } from "@/types/utils.js";

export type ModelDefinition = {
  [key: string]:
    | string
    | bigint
    | number
    | boolean
    | (string | bigint | number | boolean)[];
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

type OperatorMap<
  TField extends
    | string
    | bigint
    | number
    | boolean
    | (string | bigint | number | boolean)[],
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
        contains?: TField;
        notContains?: TField;
        startsWith?: TField;
        notStartsWith?: TField;
        endsWith?: TField;
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

export type WhereInput<TModel extends ModelDefinition> = {
  [FieldName in keyof TModel]?:
    | Prettify<OperatorMap<TModel[FieldName]>>
    | TModel[FieldName];
};

export type OrderByInput<TModel extends ModelDefinition> =
  | {
      [FieldName in keyof TModel]?: "asc" | "desc";
    }
  | {
      [FieldName in keyof TModel]?: "asc" | "desc";
    }[];

export interface IndexingStore {
  schema?: Schema;
  versionId?: string;

  reload(options?: { schema?: Schema }): Promise<void>;
  kill(): Promise<void>;

  revert(options: { safeTimestamp: number }): Promise<void>;

  findUnique(options: {
    modelName: string;
    timestamp?: number;
    id: string | number | bigint;
  }): Promise<ModelInstance | null>;

  findMany(options: {
    modelName: string;
    timestamp?: number;
    where?: WhereInput<any>;
    skip?: number;
    take?: number;
    orderBy?: OrderByInput<any>;
  }): Promise<ModelInstance[]>;

  create(options: {
    modelName: string;
    timestamp: number;
    id: string | number | bigint;
    data?: Omit<ModelInstance, "id">;
  }): Promise<ModelInstance>;

  createMany(options: {
    modelName: string;
    timestamp: number;
    data: ModelInstance[];
  }): Promise<ModelInstance[]>;

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

  updateMany(options: {
    modelName: string;
    timestamp: number;
    where?: WhereInput<any>;
    data?:
      | Partial<Omit<ModelInstance, "id">>
      | ((args: {
          current: ModelInstance;
        }) => Partial<Omit<ModelInstance, "id">>);
  }): Promise<ModelInstance[]>;

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
