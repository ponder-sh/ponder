import type { Schema } from "@/schema/types.js";
import type { Prettify } from "@/types/utils.js";
import type { Checkpoint } from "@/utils/checkpoint.js";
import type { Kysely } from "kysely";
import type { Hex } from "viem";

export type Table = {
  [key: string]:
    | string
    | bigint
    | number
    | boolean
    | Hex
    | (string | bigint | number | boolean | Hex)[];
};

export type Row = {
  id: string | number | bigint | Hex;
  [key: string]:
    | string
    | bigint
    | number
    | boolean
    | Hex
    | (string | bigint | number | boolean | Hex)[]
    | null;
};

type OperatorMap<
  TField extends
    | string
    | bigint
    | number
    | boolean
    | Hex
    | (string | bigint | number | boolean | Hex)[],
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
    ? TField extends Hex
      ? {}
      : {
          contains?: TField;
          notContains?: TField;
          startsWith?: TField;
          notStartsWith?: TField;
          endsWith?: TField;
          notEndsWith?: TField;
        }
    : {}) &
  (TField extends number | bigint | Hex
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

export type OrderByInput<table, columns extends keyof table = keyof table> = {
  [ColumnName in columns]?: "asc" | "desc";
};

export interface IndexingStore {
  kind: "sqlite" | "postgres";
  db: Kysely<any>;

  schema?: Schema;

  reload(options?: { schema?: Schema }): Promise<void>;

  teardown(): Promise<void>;

  kill(): Promise<void>;

  publish(): Promise<void>;

  revert(options: { checkpoint: Checkpoint }): Promise<void>;

  findUnique(options: {
    tableName: string;
    checkpoint?: Checkpoint;
    id: string | number | bigint;
  }): Promise<Row | null>;

  findMany(options: {
    tableName: string;
    checkpoint?: Checkpoint;
    where?: WhereInput<any>;
    orderBy?: OrderByInput<any>;
    before?: string | null;
    after?: string | null;
    limit?: number;
  }): Promise<{
    items: Row[];
    pageInfo: {
      startCursor: string | null;
      endCursor: string | null;
      hasNextPage: boolean;
      hasPreviousPage: boolean;
    };
  }>;

  create(options: {
    tableName: string;
    checkpoint: Checkpoint;
    id: string | number | bigint;
    data?: Omit<Row, "id">;
  }): Promise<Row>;

  createMany(options: {
    tableName: string;
    checkpoint: Checkpoint;
    data: Row[];
  }): Promise<Row[]>;

  update(options: {
    tableName: string;
    checkpoint: Checkpoint;
    id: string | number | bigint;
    data?:
      | Partial<Omit<Row, "id">>
      | ((args: { current: Row }) => Partial<Omit<Row, "id">>);
  }): Promise<Row>;

  updateMany(options: {
    tableName: string;
    checkpoint: Checkpoint;
    where?: WhereInput<any>;
    data?:
      | Partial<Omit<Row, "id">>
      | ((args: { current: Row }) => Partial<Omit<Row, "id">>);
  }): Promise<Row[]>;

  upsert(options: {
    tableName: string;
    checkpoint: Checkpoint;
    id: string | number | bigint;
    create?: Omit<Row, "id">;
    update?:
      | Partial<Omit<Row, "id">>
      | ((args: { current: Row }) => Partial<Omit<Row, "id">>);
  }): Promise<Row>;

  delete(options: {
    tableName: string;
    checkpoint: Checkpoint;
    id: string | number | bigint;
  }): Promise<boolean>;
}
