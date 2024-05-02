import type {
  UserColumn,
  UserIdColumn,
  UserRow,
  UserTable,
} from "@/types/schema.js";
import type { Prettify } from "@/types/utils.js";
import type { Hex } from "viem";

export type ReadonlyStore = {
  findUnique(options: {
    tableName: string;
    id: UserIdColumn;
  }): Promise<UserRow | null>;

  findMany(options: {
    tableName: string;
    where?: WhereInput<any>;
    orderBy?: OrderByInput<any>;
    before?: string | null;
    after?: string | null;
    limit?: number;
  }): Promise<{
    items: UserRow[];
    pageInfo: {
      startCursor: string | null;
      endCursor: string | null;
      hasNextPage: boolean;
      hasPreviousPage: boolean;
    };
  }>;
};

export type WriteStore<
  env extends "historical" | "realtime",
  ///
  checkpointProp = env extends "realtime"
    ? { encodedCheckpoint: string }
    : { encodedCheckpoint?: never },
> = {
  create(
    options: {
      tableName: string;
      id: UserIdColumn;
      data?: Omit<UserRow, "id">;
    } & checkpointProp,
  ): Promise<UserRow>;

  createMany(
    options: {
      tableName: string;
      data: UserRow[];
    } & checkpointProp,
  ): Promise<UserRow[]>;

  update(
    options: {
      tableName: string;
      id: UserIdColumn;
      data?:
        | Partial<Omit<UserRow, "id">>
        | ((args: { current: UserRow }) => Partial<Omit<UserRow, "id">>);
    } & checkpointProp,
  ): Promise<UserRow>;

  updateMany(
    options: {
      tableName: string;
      where?: WhereInput<any>;
      data?:
        | Partial<Omit<UserRow, "id">>
        | ((args: { current: UserRow }) => Partial<Omit<UserRow, "id">>);
    } & checkpointProp,
  ): Promise<UserRow[]>;

  upsert(
    options: {
      tableName: string;
      id: UserIdColumn;
      create?: Omit<UserRow, "id">;
      update?:
        | Partial<Omit<UserRow, "id">>
        | ((args: { current: UserRow }) => Partial<Omit<UserRow, "id">>);
    } & checkpointProp,
  ): Promise<UserRow>;

  delete(
    options: {
      tableName: string;
      id: UserIdColumn;
    } & checkpointProp,
  ): Promise<boolean>;
};

export type IndexingStore<
  env extends "historical" | "realtime" = "historical" | "realtime",
> = ReadonlyStore & WriteStore<env>;

type OperatorMap<column extends UserColumn> = {
  equals?: column;
  not?: column;
} & (column extends unknown[]
  ? {
      has?: column[number];
      notHas?: column[number];
    }
  : {
      in?: column[];
      notIn?: column[];
    }) &
  (column extends string
    ? column extends Hex
      ? {}
      : {
          contains?: column;
          notContains?: column;
          startsWith?: column;
          notStartsWith?: column;
          endsWith?: column;
          notEndsWith?: column;
        }
    : {}) &
  (column extends number | bigint | Hex
    ? {
        gt?: column;
        gte?: column;
        lt?: column;
        lte?: column;
      }
    : {});

export type WhereInput<table extends UserTable> = {
  [columnName in keyof table]?:
    | Prettify<OperatorMap<table[columnName]>>
    | table[columnName];
} & {
  AND?: Prettify<WhereInput<table>>[];
  OR?: Prettify<WhereInput<table>>[];
};

export type OrderByInput<table, columns extends keyof table = keyof table> = {
  [ColumnName in columns]?: "asc" | "desc";
};
