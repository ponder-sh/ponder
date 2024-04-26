import type { Prettify } from "@/types/utils.js";
import type { Hex } from "viem";

export type ReadIndexingStore = {
  findUnique(options: {
    tableName: string;
    id: string | number | bigint;
  }): Promise<Row | null>;

  findMany(options: {
    tableName: string;
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
};

export type WriteIndexingStore<
  env extends "historical" | "realtime",
  ///
  checkpointProp = env extends "realtime"
    ? {
        encodedCheckpoint: string;
      }
    : {
        encodedCheckpoint?: never;
      },
> = {
  create(
    options: {
      tableName: string;
      id: string | number | bigint;
      data?: Omit<Row, "id">;
    } & checkpointProp,
  ): Promise<Row>;

  createMany(
    options: {
      tableName: string;
      data: Row[];
    } & checkpointProp,
  ): Promise<Row[]>;

  update(
    options: {
      tableName: string;
      id: string | number | bigint;
      data?:
        | Partial<Omit<Row, "id">>
        | ((args: { current: Row }) => Partial<Omit<Row, "id">>);
    } & checkpointProp,
  ): Promise<Row>;

  updateMany(
    options: {
      tableName: string;
      where?: WhereInput<any>;
      data?:
        | Partial<Omit<Row, "id">>
        | ((args: { current: Row }) => Partial<Omit<Row, "id">>);
    } & checkpointProp,
  ): Promise<Row[]>;

  upsert(
    options: {
      tableName: string;
      id: string | number | bigint;
      create?: Omit<Row, "id">;
      update?:
        | Partial<Omit<Row, "id">>
        | ((args: { current: Row }) => Partial<Omit<Row, "id">>);
    } & checkpointProp,
  ): Promise<Row>;

  delete(
    options: {
      tableName: string;
      id: string | number | bigint;
    } & checkpointProp,
  ): Promise<boolean>;
};

export type IndexingStore<
  env extends "historical" | "realtime" = "historical" | "realtime",
> = ReadIndexingStore & WriteIndexingStore<env>;

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
} & {
  AND?: Prettify<WhereInput<TTable>>[];
  OR?: Prettify<WhereInput<TTable>>[];
};

export type OrderByInput<table, columns extends keyof table = keyof table> = {
  [ColumnName in columns]?: "asc" | "desc";
};
