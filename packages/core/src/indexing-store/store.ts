import type {
  UserId,
  UserRecord,
  UserTable,
  UserValue,
} from "@/types/schema.js";
import type { Prettify } from "@/types/utils.js";
import type { Hex } from "viem";

export type ReadonlyStore = {
  findUnique(options: {
    tableName: string;
    id: UserId;
  }): Promise<UserRecord | null>;

  findMany(options: {
    tableName: string;
    where?: WhereInput<any>;
    orderBy?: OrderByInput<any>;
    before?: string | null;
    after?: string | null;
    limit?: number;
  }): Promise<{
    items: UserRecord[];
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
      id: UserId;
      data?: Omit<UserRecord, "id">;
    } & checkpointProp,
  ): Promise<UserRecord>;

  createMany(
    options: {
      tableName: string;
      data: UserRecord[];
    } & checkpointProp,
  ): Promise<UserRecord[]>;

  update(
    options: {
      tableName: string;
      id: UserId;
      data?:
        | Partial<Omit<UserRecord, "id">>
        | ((args: { current: UserRecord }) => Partial<Omit<UserRecord, "id">>);
    } & checkpointProp,
  ): Promise<UserRecord>;

  updateMany(
    options: {
      tableName: string;
      where?: WhereInput<any>;
      data?:
        | Partial<Omit<UserRecord, "id">>
        | ((args: { current: UserRecord }) => Partial<Omit<UserRecord, "id">>);
    } & checkpointProp,
  ): Promise<UserRecord[]>;

  upsert(
    options: {
      tableName: string;
      id: UserId;
      create?: Omit<UserRecord, "id">;
      update?:
        | Partial<Omit<UserRecord, "id">>
        | ((args: { current: UserRecord }) => Partial<Omit<UserRecord, "id">>);
    } & checkpointProp,
  ): Promise<UserRecord>;

  delete(
    options: {
      tableName: string;
      id: UserId;
    } & checkpointProp,
  ): Promise<boolean>;
};

export type RealtimeStore = ReadonlyStore & WriteStore<"realtime">;

export type HistoricalStore = ReadonlyStore &
  WriteStore<"historical"> & {
    flush: (arg: { isFullFlush: boolean }) => Promise<void>;
  };

export type Status = {
  [networkName: string]: {
    block: { number: number; timestamp: number } | null;
    ready: boolean;
  };
};

export type MetadataStore = {
  setStatus: (status: Status) => Promise<void>;
  getStatus: () => Promise<Status | null>;
};

export type IndexingStore<
  env extends "historical" | "realtime" = "historical" | "realtime",
> = ReadonlyStore & WriteStore<env>;

type OperatorMap<column extends UserValue> = {
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
