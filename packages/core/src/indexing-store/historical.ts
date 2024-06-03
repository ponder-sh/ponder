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
import { encodeRow, encodeValue } from "./utils/encoding.js";
import { parseStoreError } from "./utils/errors.js";

const MAX_BATCH_SIZE = 1_000;
const MAX_CACHE_SIZE = 50_000;
const CACHE_FLUSH = 0.1;
// @ts-expect-error
const DEFAULT_LIMIT = 50;
// @ts-expect-error
const MAX_LIMIT = 1_000;

type Insert = {
  type: "insert";
  opIndex: number;
  record: UserRecord;
};

type Update = {
  type: "update";
  opIndex: number;
  record: UserRecord;
};

// type Delete = {
//   type: "delete";
//   opIndex: number;
// };

// TODO(kyle) should this be { [id : string | number]: Insert | Update | Delete }
type StoreCache = {
  [tableName: string]: {
    insert: { [id: string | number]: Insert };
    update: { [id: string | number]: Update };
    // delete: { [id: string | number]: Delete };
  };
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
  let isCacheFull = true;
  let cacheSize = 0;
  let totalCacheOps = 0;

  const readonlyStore = getReadonlyStore({ kind, schema, namespaceInfo, db });

  for (const tableName of Object.keys(getTables(schema))) {
    storeCache[tableName] = {
      insert: {},
      update: {},
      // delete: {},
    };
  }

  const flush = async (fullFlush = true) => {
    const flushIndex = totalCacheOps - cacheSize * (1 - CACHE_FLUSH);

    await Promise.all(
      Object.entries(storeCache).map(async ([tableName, tableStoreCache]) => {
        const table = (schema[tableName] as { table: Table }).table;

        let rows: UserRecord[];

        if (fullFlush) {
          rows = Object.values(tableStoreCache.insert).map(
            ({ record }) => record,
          );
        } else {
          rows = Object.values(tableStoreCache.insert)
            .filter(({ opIndex }) => opIndex < flushIndex)
            .map(({ record }) => record);
        }

        if (rows.length === 0) return;

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
                throw parseStoreError(err, _rows.length > 0 ? _rows[0] : {});
              });
          });
        }
      }),
    );

    if (fullFlush) {
      for (const tableName of Object.keys(getTables(schema))) {
        storeCache[tableName] = {
          insert: {},
          update: {},
          // delete: {},
        };
      }
      cacheSize = 0;
    } else {
      for (const [tableName, tableStoreCache] of Object.entries(storeCache)) {
        for (const [id, { opIndex }] of Object.entries(
          tableStoreCache.insert,
        )) {
          if (opIndex < flushIndex) {
            delete storeCache[tableName].insert[id];
            cacheSize--;
          }
        }
      }
    }

    isCacheFull = false;
  };

  return {
    findUnique: async ({
      tableName,
      id,
    }: {
      tableName: string;
      id: UserId;
    }) => {
      const cacheRecord =
        storeCache[tableName].insert[encodeCacheId(id)]?.record ??
        storeCache[tableName].update[encodeCacheId(id)]?.record;

      if (cacheRecord !== undefined) return cacheRecord;
      if (isCacheFull) return null;

      // TODO(kyle) load result into cache
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
      if (cacheSize + 1 > MAX_CACHE_SIZE) await flush(false);

      const encodedId = encodeCacheId(id);

      if (
        storeCache[tableName].insert[encodedId] !== undefined ||
        storeCache[tableName].update[encodedId] !== undefined
      ) {
        throw new UniqueConstraintError();
      }

      const record = data as UserRecord;
      record.id = id;

      // Note: this is where not-null constraints would be checked.
      // It may be safe to wait until flush to throw the error.

      storeCache[tableName].insert[encodedId] = {
        type: "insert",
        opIndex: totalCacheOps++,
        record,
      };

      cacheSize++;

      return record;
    },
    createMany: async ({
      tableName,
      data,
    }: {
      tableName: string;
      data: UserRecord[];
    }) => {
      // TODO(kyle) what if data size is more than the max cache rows

      for (const record of data) {
        const encodedId = encodeCacheId(record.id);

        if (
          storeCache[tableName].insert[encodedId] !== undefined ||
          storeCache[tableName].update[encodedId] !== undefined
        ) {
          throw new UniqueConstraintError();
        }

        // Note: this is where not-null constraints would be checked.
        // It may be safe to wait until flush to throw the error.

        storeCache[tableName].insert[encodeCacheId(record.id)] = {
          type: "insert",
          opIndex: totalCacheOps++,
          record,
        };
      }

      cacheSize += data.length;

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
      const encodedId = encodeCacheId(id);

      let cacheEntry: Insert | Update;

      const insertEntry = storeCache[tableName].insert[encodedId];
      const updateEntry = storeCache[tableName].update[encodedId];

      if (updateEntry !== undefined) {
        cacheEntry = updateEntry;
      } else if (insertEntry !== undefined) {
        cacheEntry = insertEntry;
      } else if (isCacheFull) {
        throw new RecordNotFoundError();
      } else {
        const record = await readonlyStore.findUnique({ tableName, id });

        if (record === null) throw new RecordNotFoundError();

        // Note: a "spoof" cache entry is created
        cacheEntry = {
          type: "update",
          opIndex: 0,
          record,
        };

        storeCache[tableName].update[encodedId] = cacheEntry;
      }

      const update =
        typeof data === "function"
          ? data({ current: cacheEntry.record })
          : data;

      const record: UserRecord = {
        ...cacheEntry.record,
        ...update,
      };

      cacheEntry.record = record;
      cacheEntry.opIndex = totalCacheOps++;

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
      const encodedId = encodeCacheId(id);

      let cacheEntry: Insert | Update | undefined;

      const insertEntry = storeCache[tableName].insert[encodedId];
      const updateEntry = storeCache[tableName].update[encodedId];

      if (updateEntry !== undefined) {
        cacheEntry = updateEntry;
      } else if (insertEntry !== undefined) {
        cacheEntry = insertEntry;
      } else if (isCacheFull === false) {
        const record = await readonlyStore.findUnique({ tableName, id });

        if (record !== null) {
          // Note: a "spoof" cache entry is created
          cacheEntry = {
            type: "update",
            opIndex: 0,
            record,
          };
          storeCache[tableName].update[encodedId] = cacheEntry;
        }
      }

      if (cacheEntry === undefined) {
        const record = create as UserRecord;
        record.id = id;

        // Note: this is where not-null constraints would be checked.
        // It may be safe to wait until flush to throw the error.

        storeCache[tableName].insert[encodedId] = {
          type: "insert",
          opIndex: totalCacheOps++,
          record,
        };

        cacheSize++;

        return record;
      } else {
        const _update =
          typeof update === "function"
            ? update({ current: cacheEntry.record })
            : update;

        const record: UserRecord = {
          ...cacheEntry.record,
          ..._update,
        };

        cacheEntry.record = record;
        cacheEntry.opIndex = totalCacheOps++;

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
      const encodedId = encodeCacheId(id);

      const insertEntry = storeCache[tableName].insert[encodedId];
      const updateEntry = storeCache[tableName].update[encodedId];

      if (insertEntry !== undefined) {
        delete storeCache[tableName].insert[encodedId];

        cacheSize--;

        return true;
      } else if (isCacheFull) {
        return false;
      } else {
        const table = (schema[tableName] as { table: Table }).table;

        if (updateEntry !== undefined) {
          delete storeCache[tableName].update[encodedId];
        }

        const deletedRow = await db
          .withSchema(namespaceInfo.userNamespace)
          .deleteFrom(tableName)
          .where("id", "=", encodeValue(id, table.id, kind))
          .returning(["id"])
          .executeTakeFirst()
          .catch((err) => {
            throw parseStoreError(err, { id });
          });

        return !!deletedRow;
      }
    },
    flush,
  };
};
