import { RecordNotFoundError, UniqueConstraintError } from "@/common/errors.js";
import type { Logger } from "@/common/logger.js";
import { HeadlessKysely } from "@/database/kysely.js";
import type { NamespaceInfo } from "@/database/service.js";
import type { Schema, Table } from "@/schema/common.js";
import {
  getTables,
  isEnumColumn,
  isJSONColumn,
  isReferenceColumn,
  isScalarColumn,
} from "@/schema/utils.js";
import type {
  DatabaseColumn,
  DatabaseRecord,
  UserId,
  UserRecord,
} from "@/types/schema.js";
import { toLowerCase } from "@/utils/lowercase.js";
import { createQueue } from "@ponder/common";
import { sql } from "kysely";
import { getReadonlyStore } from "./readonly.js";
import type { HistoricalStore, OrderByInput, WhereInput } from "./store.js";
import { decodeRow, encodeRow, encodeValue } from "./utils/encoding.js";
import { parseStoreError } from "./utils/errors.js";
import { buildWhereConditions } from "./utils/filter.js";

const MAX_BATCH_SIZE = 1_000;
const CACHE_FLUSH = 0.35;

type Entry = {
  opIndex: number;
  bytes: number;
  record: UserRecord;
};

type StoreCache = {
  [tableName: string]: {
    insert: { [id: string | number]: Entry };
    update: { [id: string | number]: Entry };
  };
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

  const maxSizeBytes = process.memoryUsage().heapTotal / 3;
  /** True if the cache contains the complete state of the store. */
  let isCacheFull = true;
  let totalCacheOps = 0;
  let cacheSize = 0;
  let cacheSizeBytes = 0;

  const readonlyStore = getReadonlyStore({ kind, schema, namespaceInfo, db });

  for (const tableName of Object.keys(getTables(schema))) {
    storeCache[tableName] = {
      insert: {},
      update: {},
    };
  }

  const getRecordSize = (record: UserRecord) => {
    // size of metadata
    let size = 16;
    for (const col of Object.values(record)) {
      if (typeof col === "number") {
        // p.float, p.int
        size += 8;
      } else if (typeof col === "string") {
        // p.hex, p.string, p.enum
        size += 2 * col.length;
      } else if (typeof col === "boolean") {
        // p.boolean
        size += 4;
      } else if (typeof col === "bigint") {
        // p.bigint
        size += 48;
      } else if (Array.isArray(col)) {
        // p.list
        for (const e of col) {
          size += getRecordSize(e);
        }
      } else if (col === null || col === undefined) {
        size += 8;
      } else {
        // p.json
        for (const e of Object.values(col)) {
          size += getRecordSize(e);
        }
      }
    }
    return size;
  };

  const isIdColumnHex = Object.entries(getTables(schema)).reduce<{
    [tableName: string]: boolean;
  }>((acc, [tableName, { table }]) => {
    acc[tableName] = table.id[" scalar"] === "hex";
    return acc;
  }, {});

  const encodeCacheId = (id: UserId, tableName: string): string | number => {
    if (isIdColumnHex[tableName]) return toLowerCase(id as string);
    if (typeof id === "bigint") return `#Bigint.${id}`;
    return id;
  };

  const shouldFlush = () => {
    return cacheSizeBytes > maxSizeBytes;
  };

  const flush = createQueue<void, boolean | void>({
    concurrency: 1,
    initialStart: true,
    browser: false,
    worker: async (fullFlush = true) => {
      const flushIndex = totalCacheOps - cacheSize * (1 - CACHE_FLUSH);

      await Promise.all(
        Object.entries(storeCache).map(
          async ([tableName, tableStoreCache]) => {
            const table = (schema[tableName] as { table: Table }).table;

            let insertRows: UserRecord[];
            let updateRows: UserRecord[];

            if (fullFlush) {
              insertRows = Object.values(tableStoreCache.insert).map(
                ({ record }) => record,
              );
              updateRows = Object.values(tableStoreCache.update).map(
                ({ record }) => record,
              );
            } else {
              insertRows = Object.values(tableStoreCache.insert)
                .filter(({ opIndex }) => opIndex < flushIndex)
                .map(({ record }) => record);

              updateRows = Object.values(tableStoreCache.update)
                .filter(({ opIndex }) => opIndex < flushIndex)
                .map(({ record }) => record);
            }

            if (insertRows.length + updateRows.length === 0) return;

            logger.debug({
              service: "indexing",
              msg: `Flushing ${
                insertRows.length + updateRows.length
              } '${tableName}' database records from cache`,
            });

            // insert
            for (
              let i = 0, len = insertRows.length;
              i < len;
              i += MAX_BATCH_SIZE
            ) {
              await db.wrap({ method: `${tableName}.flush` }, async () => {
                const _insertRows = insertRows
                  .slice(i, i + MAX_BATCH_SIZE)
                  .map((d) => encodeRow(d, table, kind));

                await db
                  .withSchema(namespaceInfo.userNamespace)
                  .insertInto(tableName)
                  .values(_insertRows)
                  .execute()
                  .catch((err) => {
                    throw parseStoreError(
                      err,
                      _insertRows.length > 0 ? _insertRows[0] : {},
                    );
                  });
              });
            }

            // update
            for (
              let i = 0, len = updateRows.length;
              i < len;
              i += MAX_BATCH_SIZE
            ) {
              await db.wrap({ method: `${tableName}.flush` }, async () => {
                const _updateRows = updateRows
                  .slice(i, i + MAX_BATCH_SIZE)
                  .map((d) => encodeRow(d, table, kind));

                await db
                  .withSchema(namespaceInfo.userNamespace)
                  .insertInto(tableName)
                  .values(_updateRows)
                  .onConflict((oc) =>
                    oc.column("id").doUpdateSet((eb) =>
                      Object.entries(table).reduce<any>(
                        (acc, [colName, column]) => {
                          if (colName !== "id") {
                            if (
                              isScalarColumn(column) ||
                              isReferenceColumn(column) ||
                              isEnumColumn(column) ||
                              isJSONColumn(column)
                            ) {
                              acc[colName] = eb.ref(`excluded.${colName}`);
                            }
                          }
                          return acc;
                        },
                        {},
                      ),
                    ),
                  )
                  .execute()
                  .catch((err) => {
                    throw parseStoreError(
                      err,
                      _updateRows.length > 0 ? _updateRows[0] : {},
                    );
                  });
              });
            }
          },
        ),
      );

      if (fullFlush) {
        for (const tableName of Object.keys(getTables(schema))) {
          storeCache[tableName] = {
            insert: {},
            update: {},
          };
        }
        cacheSize = 0;
        cacheSizeBytes = 0;
      } else {
        for (const [tableName, tableStoreCache] of Object.entries(storeCache)) {
          for (const [id, { opIndex }] of Object.entries(
            tableStoreCache.insert,
          )) {
            if (opIndex < flushIndex) {
              const bytes = storeCache[tableName].insert[id].bytes;
              delete storeCache[tableName].insert[id];

              cacheSize--;
              cacheSizeBytes -= bytes;
            }
          }

          for (const [id, { opIndex }] of Object.entries(
            tableStoreCache.update,
          )) {
            if (opIndex < flushIndex) {
              const bytes = storeCache[tableName].insert[id].bytes;
              delete storeCache[tableName].insert[id];

              cacheSize--;
              cacheSizeBytes -= bytes;
            }
          }
        }
      }

      isCacheFull = false;
    },
  }).add;

  return {
    findUnique: async ({
      tableName,
      id,
    }: {
      tableName: string;
      id: UserId;
    }) => {
      const encodedId = encodeCacheId(id, tableName);

      const cacheRecord =
        storeCache[tableName].insert[encodedId]?.record ??
        storeCache[tableName].update[encodedId]?.record;

      if (cacheRecord !== undefined) return cacheRecord;
      if (isCacheFull) return null;

      // TODO(kyle) load result into cache
      return readonlyStore.findUnique({ tableName, id });
    },
    findMany: async (arg: {
      tableName: string;
      where?: WhereInput<any>;
      orderBy?: OrderByInput<any>;
      before?: string | null;
      after?: string | null;
      limit?: number;
    }) => {
      await flush(true);

      return readonlyStore.findMany(arg);
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
      const encodedId = encodeCacheId(id, tableName);

      if (
        storeCache[tableName].insert[encodedId] !== undefined ||
        storeCache[tableName].update[encodedId] !== undefined
      ) {
        throw new UniqueConstraintError();
      }

      const record = { ...data, id };

      // Note: this is where not-null constraints would be checked.
      // It may be safe to wait until flush to throw the error.

      const bytes = getRecordSize(record);

      storeCache[tableName].insert[encodedId] = {
        opIndex: totalCacheOps++,
        bytes,
        record,
      };

      cacheSizeBytes += bytes;
      cacheSize++;

      if (shouldFlush()) await flush(false);

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
        const encodedId = encodeCacheId(record.id, tableName);

        if (
          storeCache[tableName].insert[encodedId] !== undefined ||
          storeCache[tableName].update[encodedId] !== undefined
        ) {
          throw new UniqueConstraintError();
        }

        // Note: this is where not-null constraints would be checked.
        // It may be safe to wait until flush to throw the error.

        const bytes = getRecordSize(record);

        storeCache[tableName].insert[encodedId] = {
          opIndex: totalCacheOps++,
          bytes,
          record,
        };

        cacheSizeBytes += bytes;
      }

      cacheSize += data.length;

      if (shouldFlush()) await flush(false);

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
      const encodedId = encodeCacheId(id, tableName);

      let cacheEntry: Entry;

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
          opIndex: 0,
          bytes: 0,
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

      const bytes = getRecordSize(record);

      cacheEntry.record = record;
      cacheEntry.opIndex = totalCacheOps++;
      cacheEntry.bytes = bytes;

      return record;
    },
    updateMany: async ({
      tableName,
      where,
      data = {},
    }: {
      tableName: string;
      where: WhereInput<any>;
      data?:
        | Partial<Omit<UserRecord, "id">>
        | ((args: { current: UserRecord }) => Partial<Omit<UserRecord, "id">>);
    }) => {
      await flush(true);
      const table = (schema[tableName] as { table: Table }).table;

      if (typeof data === "function") {
        const query = db
          .withSchema(namespaceInfo.userNamespace)
          .selectFrom(tableName)
          .selectAll()
          .where((eb) =>
            buildWhereConditions({
              eb,
              where,
              table,
              encoding: kind,
            }),
          )
          .orderBy("id", "asc");

        const rows: UserRecord[] = [];
        let cursor: DatabaseColumn = null;

        while (true) {
          const _rows = await db.wrap(
            { method: `${tableName}.updateMany` },
            async () => {
              const latestRows: DatabaseRecord[] = await query
                .limit(MAX_BATCH_SIZE)
                .$if(cursor !== null, (qb) => qb.where("id", ">", cursor))
                .execute();

              const rows: DatabaseRecord[] = [];

              for (const latestRow of latestRows) {
                const current = decodeRow(latestRow, table, kind);
                const updateObject = data({ current });
                // Here, `latestRow` is already encoded, so we need to exclude it from `encodeRow`.
                const updateRow = {
                  id: latestRow.id,
                  ...encodeRow(updateObject, table, kind),
                };

                const row = await db
                  .withSchema(namespaceInfo.userNamespace)
                  .updateTable(tableName)
                  .set(updateRow)
                  .where("id", "=", latestRow.id)
                  .returningAll()
                  .executeTakeFirstOrThrow()
                  .catch((err) => {
                    throw parseStoreError(err, updateObject);
                  });
                rows.push(row);
              }

              return rows.map((row) => decodeRow(row, table, kind));
            },
          );

          rows.push(..._rows);

          if (_rows.length === 0) {
            break;
          } else {
            cursor = encodeValue(_rows[_rows.length - 1].id, table.id, kind);
          }
        }

        return rows;
      } else {
        return db.wrap({ method: `${tableName}.updateMany` }, async () => {
          const updateRow = encodeRow(data, table, kind);

          const rows = await db
            .with("latestRows(id)", (db) =>
              db
                .withSchema(namespaceInfo.userNamespace)
                .selectFrom(tableName)
                .select("id")
                .where((eb) =>
                  buildWhereConditions({
                    eb,
                    where,
                    table,
                    encoding: kind,
                  }),
                ),
            )
            .withSchema(namespaceInfo.userNamespace)
            .updateTable(tableName)
            .set(updateRow)
            .from("latestRows")
            .where(`${tableName}.id`, "=", sql.ref("latestRows.id"))
            .returningAll()
            .execute()
            .catch((err) => {
              throw parseStoreError(err, data);
            });

          return rows.map((row) => decodeRow(row, table, kind));
        });
      }
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
      const encodedId = encodeCacheId(id, tableName);

      let cacheEntry: Entry | undefined;

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
            opIndex: 0,
            bytes: 0,
            record,
          };
          storeCache[tableName].update[encodedId] = cacheEntry;
        }
      }

      if (cacheEntry === undefined) {
        // insert/create branch

        const record = { ...create, id };

        // Note: this is where not-null constraints would be checked.
        // It may be safe to wait until flush to throw the error.

        const bytes = getRecordSize(record);

        storeCache[tableName].insert[encodedId] = {
          opIndex: totalCacheOps++,
          bytes,
          record,
        };

        cacheSize++;
        cacheSizeBytes += bytes;

        if (shouldFlush()) await flush(false);

        return record;
      } else {
        // update branch

        const _update =
          typeof update === "function"
            ? update({ current: cacheEntry.record })
            : update;

        const record: UserRecord = {
          ...cacheEntry.record,
          ..._update,
        };

        const bytes = getRecordSize(record);

        cacheEntry.record = record;
        cacheEntry.opIndex = totalCacheOps++;
        cacheEntry.bytes = bytes;

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
      const encodedId = encodeCacheId(id, tableName);

      const insertEntry = storeCache[tableName].insert[encodedId];
      const updateEntry = storeCache[tableName].update[encodedId];

      if (insertEntry !== undefined) {
        const bytes = insertEntry.bytes;
        delete storeCache[tableName].insert[encodedId];

        cacheSize--;
        cacheSizeBytes -= bytes;

        return true;
      } else if (isCacheFull) {
        return false;
      } else {
        const table = (schema[tableName] as { table: Table }).table;

        if (updateEntry !== undefined) {
          const bytes = updateEntry.bytes;
          delete storeCache[tableName].update[encodedId];

          cacheSize--;
          cacheSizeBytes -= bytes;
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
