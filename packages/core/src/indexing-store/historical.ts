import {
  NonRetryableError,
  RecordNotFoundError,
  UniqueConstraintError,
} from "@/common/errors.js";
import type { Logger } from "@/common/logger.js";
import { HeadlessKysely } from "@/database/kysely.js";
import type { NamespaceInfo } from "@/database/service.js";
import type { Schema, Table } from "@/schema/common.js";
import { getTables } from "@/schema/utils.js";
import type { UserId, UserRecord } from "@/types/schema.js";
import { getReadonlyStore } from "./readonly.js";
import type { HistoricalStore, OrderByInput, WhereInput } from "./store.js";
import { encodeRow } from "./utils/encoding.js";
import { parseStoreError } from "./utils/errors.js";

const MAX_BATCH_SIZE = 1_000 as const;
// @ts-expect-error
const DEFAULT_LIMIT = 50 as const;
// @ts-expect-error
const MAX_LIMIT = 1_000 as const;
// @ts-expect-error
const MAX_CACHE = 50_000;

type Insert = {
  type: "insert";
  record: UserRecord;
};

// type Update = any;
// type Delete = any;

type StoreCache = {
  [tableName: string]: { [id: Exclude<UserId, bigint>]: Insert };
};

const encodeCacheId = (id: UserId): string | number => {
  if (typeof id === "bigint") return `#Bigint.${id}`;
  return id;
};

export const getHistoricalStore = ({
  kind,
  schema,
  namespaceInfo,
  db,
  logger,
}: {
  kind: "sqlite" | "postgres";
  schema: Schema;
  namespaceInfo: NamespaceInfo;
  db: HeadlessKysely<any>;
  logger: Logger;
}): HistoricalStore => {
  const storeCache: StoreCache = {};
  /** True if the cache contains the complete state of the store. */
  const isCacheFull = true;

  const readonlyStore = getReadonlyStore({ kind, schema, namespaceInfo, db });

  for (const tableName of Object.keys(getTables(schema))) {
    storeCache[tableName] = {};
  }

  return {
    findUnique: async ({
      tableName,
      id,
    }: {
      tableName: string;
      id: UserId;
    }) => {
      const cacheRecord = storeCache[tableName][encodeCacheId(id)]?.record;

      if (cacheRecord !== undefined) return cacheRecord;
      if (isCacheFull) return null;
      return readonlyStore.findUnique({ tableName, id });
    },
    findMany: async (_: {
      tableName: string;
      where?: WhereInput<any>;
      orderBy?: OrderByInput<any>;
      before?: string | null;
      after?: string | null;
      limit?: number;
    }) => {
      throw new NonRetryableError("Not implemented");
    },
    create: async ({
      tableName,
      id,
      data = {},
    }: {
      tableName: string;
      id: UserId;
      data?: Omit<UserRecord, "id">;
    }) => {
      // Note: this is where not-null constraints would be checked.
      // It may be safe to wait until flush to throw the error.

      if (storeCache[tableName][encodeCacheId(id)] !== undefined) {
        throw new UniqueConstraintError();
      }

      const record = data as UserRecord;
      record.id = id;

      storeCache[tableName][encodeCacheId(id)] = {
        type: "insert",
        record,
      };

      return record;
    },
    createMany: async ({
      tableName,
      data,
    }: {
      tableName: string;
      data: UserRecord[];
    }) => {
      for (const record of data) {
        // Note: this is where not-null constraints would be checked.
        // It may be safe to wait until flush to throw the error.

        if (storeCache[tableName][encodeCacheId(record.id)] !== undefined) {
          throw new UniqueConstraintError();
        }

        storeCache[tableName][encodeCacheId(record.id)] = {
          type: "insert",
          record,
        };
      }

      return data;
    },
    update: async ({
      tableName,
      id,
      data = {},
    }: {
      tableName: string;
      id: UserId;
      data?:
        | Partial<Omit<UserRecord, "id">>
        | ((args: { current: UserRecord }) => Partial<Omit<UserRecord, "id">>);
    }) => {
      const current = storeCache[tableName][encodeCacheId(id)]?.record;

      if (current === undefined) {
        throw new RecordNotFoundError();
      }

      const update = typeof data === "function" ? data({ current }) : data;

      const record: UserRecord = {
        ...current,
        ...update,
      };

      storeCache[tableName][encodeCacheId(id)].record = record;

      return record;
    },
    updateMany: async (_: {
      tableName: string;
      where: WhereInput<any>;
      data?:
        | Partial<Omit<UserRecord, "id">>
        | ((args: { current: UserRecord }) => Partial<Omit<UserRecord, "id">>);
    }) => {
      throw new NonRetryableError("Not implemented");
    },
    upsert: async ({
      tableName,
      id,
      create = {},
      update = {},
    }: {
      tableName: string;
      id: UserId;
      create?: Omit<UserRecord, "id">;
      update?:
        | Partial<Omit<UserRecord, "id">>
        | ((args: { current: UserRecord }) => Partial<Omit<UserRecord, "id">>);
    }) => {
      const current = storeCache[tableName][encodeCacheId(id)]?.record;

      if (current === undefined) {
        // Note: this is where not-null constraints would be checked.
        // It may be safe to wait until flush to throw the error.

        const record = create as UserRecord;
        record.id = id;

        storeCache[tableName][encodeCacheId(id)] = {
          type: "insert",
          record,
        };

        return record;
      } else {
        const _update =
          typeof update === "function" ? update({ current }) : update;

        const record: UserRecord = {
          ...current,
          ..._update,
        };

        storeCache[tableName][encodeCacheId(id)].record = record;

        return record;
      }
    },
    delete: async ({
      tableName,
      id,
    }: {
      tableName: string;
      id: UserId;
    }) => {
      const record = storeCache[tableName][encodeCacheId(id)]?.record;

      if (record === undefined) return false;
      else {
        delete storeCache[tableName][encodeCacheId(id)];
        return true;
      }
    },
    flush: async () => {
      await Promise.all(
        Object.entries(storeCache).map(
          async ([tableName, tableStoreCache]) => {
            const table = (schema[tableName] as { table: Table }).table;

            const rows = Object.values(tableStoreCache).map(
              ({ record }) => record,
            );

            logger.debug({
              service: "indexing",
              msg: `Flushing ${rows.length} '${tableName}' database records from cache`,
            });

            for (let i = 0, len = rows.length; i < len; i += MAX_BATCH_SIZE) {
              await db.wrap({ method: `${tableName}.flush` }, async () => {
                const _rows = rows
                  .slice(i, i + MAX_BATCH_SIZE)
                  .map((d) => encodeRow(d, table, kind));

                await db
                  .withSchema(namespaceInfo.userNamespace)
                  .insertInto(tableName)
                  .values(_rows)
                  .execute()
                  .catch((err) => {
                    throw parseStoreError(
                      err,
                      _rows.length > 0 ? _rows[0] : {},
                    );
                  });
              });
            }
          },
        ),
      );

      for (const tableName of Object.keys(getTables(schema))) {
        storeCache[tableName] = {};
      }
    },
  };
};
