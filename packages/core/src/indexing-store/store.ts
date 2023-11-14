import type { Schema } from "@/schema/types.js";
import type { Prettify } from "@/types/utils.js";

export type Table = {
  [key: string]:
    | string
    | bigint
    | number
    | boolean
    | (string | bigint | number | boolean)[];
};

export type Row = {
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

export type WhereInput<TTable extends Table> = {
  [ColumnName in keyof TTable]?:
    | Prettify<OperatorMap<TTable[ColumnName]>>
    | TTable[ColumnName];
};

export type OrderByInput<TTable extends Table> =
  | {
      [ColumnName in keyof TTable]?: "asc" | "desc";
    }
  | {
      [ColumnName in keyof TTable]?: "asc" | "desc";
    }[];

export interface IndexingStore {
  schema?: Schema;
  versionId?: string;

  reload(options?: { schema?: Schema }): Promise<void>;
  kill(): Promise<void>;

  revert(options: { safeTimestamp: number }): Promise<void>;

  findUnique(options: {
    tableName: string;
    timestamp?: number;
    id: string | number | bigint;
  }): Promise<Row | null>;

  findMany(options: {
    tableName: string;
    timestamp?: number;
    where?: WhereInput<any>;
    skip?: number;
    take?: number;
    orderBy?: OrderByInput<any>;
  }): Promise<Row[]>;

  create(options: {
    tableName: string;
    timestamp: number;
    id: string | number | bigint;
    data?: Omit<Row, "id">;
  }): Promise<Row>;

  createMany(options: {
    tableName: string;
    timestamp: number;
    data: Row[];
  }): Promise<Row[]>;

  update(options: {
    tableName: string;
    timestamp: number;
    id: string | number | bigint;
    data?:
      | Partial<Omit<Row, "id">>
      | ((args: { current: Row }) => Partial<Omit<Row, "id">>);
  }): Promise<Row>;

  updateMany(options: {
    tableName: string;
    timestamp: number;
    where?: WhereInput<any>;
    data?:
      | Partial<Omit<Row, "id">>
      | ((args: { current: Row }) => Partial<Omit<Row, "id">>);
  }): Promise<Row[]>;

  upsert(options: {
    tableName: string;
    timestamp: number;
    id: string | number | bigint;
    create?: Omit<Row, "id">;
    update?:
      | Partial<Omit<Row, "id">>
      | ((args: { current: Row }) => Partial<Omit<Row, "id">>);
  }): Promise<Row>;

  delete(options: {
    tableName: string;
    timestamp: number;
    id: string | number | bigint;
  }): Promise<boolean>;
}
