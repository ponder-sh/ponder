import type { Common } from "@/common/common.js";
import { RecordNotFoundError, UniqueConstraintError } from "@/common/errors.js";
import { HeadlessKysely } from "@/database/kysely.js";
import type { NamespaceInfo } from "@/database/service.js";
import type { Schema, Table } from "@/schema/common.js";
import {
  getTables,
  isEnumColumn,
  isJSONColumn,
  isOptionalColumn,
  isReferenceColumn,
  isScalarColumn,
} from "@/schema/utils.js";
import type {
  DatabaseColumn,
  DatabaseRecord,
  UserColumn,
  UserId,
  UserRecord,
} from "@/types/schema.js";
import { createQueue } from "@ponder/common";
import { sql } from "kysely";
import { type Hex, padHex } from "viem";
import { getReadonlyStore } from "./readonly.js";
import type { HistoricalStore, OrderByInput, WhereInput } from "./store.js";
import {
  decodeRecord,
  encodeField,
  encodeRecord,
  validateRecord,
} from "./utils/encoding.js";
import { parseStoreError } from "./utils/errors.js";
import { buildWhereConditions } from "./utils/filter.js";

const MAX_BATCH_SIZE = 1_000;
const CACHE_FLUSH = 0.35;

/** Cache entries that need to be created in the database. */
type InsertEntry = {
  type: "insert";
  opIndex: number;
  bytes: number;
  record: UserRecord;
};

/** Cache entries that need to be updated in the database. */
type UpdateEntry = {
  type: "update";
  opIndex: number;
  bytes: number;
  record: UserRecord;
};

/** Cache entries that mirror the database. Can be `null`,
 * meaning the entry doesn't exist in the cache */
type FindEntry = {
  type: "find";
  opIndex: number;
  bytes: number;
  record: UserRecord | null;
};

type Entry = InsertEntry | UpdateEntry | FindEntry;

type Key = string | number;

/**
 * An in-memory representation of the indexing store. Every entry is
 * normalized, validated, and guaranteed to not share any references
 * with user-land.
 */
type StoreCache = {
  [tableName: string]: { [key: Key]: Entry };
};

export const getHistoricalStore = ({
  encoding,
  schema,
  namespaceInfo,
  db,
  common,
  isCacheExhaustive: _isCacheExhaustive,
}: {
  encoding: "sqlite" | "postgres";
  schema: Schema;
  namespaceInfo: NamespaceInfo;
  db: HeadlessKysely<any>;
  common: Common;
  isCacheExhaustive: boolean;
}): HistoricalStore => {
  const maxSizeBytes = common.options.indexingCacheBytes;
  const storeCache: StoreCache = {};
  const tables = getTables(schema);
  const readonlyStore = getReadonlyStore({
    encoding,
    schema,
    namespaceInfo,
    db,
  });

  common.logger.debug({
    service: "indexing",
    msg: `Using a ${Math.round(maxSizeBytes / (1024 * 1024))} mB cache.`,
  });

  /** True if the cache contains the complete state of the store. */
  let isCacheExhaustive = _isCacheExhaustive;

  /** Number of rows in cache. */
  let cacheSize = 0;
  /** Estimated number of bytes used by cache. */
  let cacheSizeBytes = 0;
  /** LRU counter. */
  let totalCacheOps = 0;

  for (const tableName of Object.keys(tables)) {
    storeCache[tableName] = {};
  }

  /**
   * Hex values must be normalized to mirror the `UInt8Array`
   * encoding. i.e. "0xa", "0xA", "0x0a", "0x0A" are all equivalent.
   */
  const normalizeHex = (hex: Hex) =>
    padHex(hex, {
      size: Math.ceil((hex.length - 2) / 2),
      dir: "left",
    }).toLowerCase();

  const getCacheKey = (id: UserId, tableName: string): Key => {
    if (tables[tableName].table.id[" scalar"] === "hex")
      return normalizeHex(id as Hex);
    if (typeof id === "bigint") return `#Bigint.${id}`;
    return id;
  };

  /**
   * Normalizes a record. In simpler terms, the shape of the record
   * will match what it would be if it was encoded and decoded.
   */
  const normalizeRecord = (record: UserRecord, tableName: string) => {
    for (const [columnName, column] of Object.entries(
      tables[tableName].table,
    )) {
      // optional columns are null
      if (isOptionalColumn(column) && record[columnName] === undefined) {
        record[columnName] = null;
      }
      // hex is lowercase byte encoded
      if (
        (isScalarColumn(column) || isReferenceColumn(column)) &&
        column[" scalar"] === "hex" &&
        typeof record[columnName] === "string"
      ) {
        record[columnName] = normalizeHex(record[columnName] as Hex);
      }
    }
  };

  const shouldFlush = () => cacheSizeBytes > maxSizeBytes;

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
              insertRows = Object.values(tableStoreCache)
                .filter(({ type }) => type === "insert")
                .map(({ record }) => record!);
              updateRows = Object.values(tableStoreCache)
                .filter(({ type }) => type === "update")
                .map(({ record }) => record!);
            } else {
              insertRows = Object.values(tableStoreCache)
                .filter(
                  ({ type, opIndex }) =>
                    type === "insert" && opIndex < flushIndex,
                )
                .map(({ record }) => record!);

              updateRows = Object.values(tableStoreCache)
                .filter(
                  ({ type, opIndex }) =>
                    type === "update" && opIndex < flushIndex,
                )
                .map(({ record }) => record!);
            }

            if (insertRows.length + updateRows.length === 0) return;

            common.logger.debug({
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
                  // skip validation because its already occurred in the store method
                  .map((record) =>
                    encodeRecord({
                      record,
                      table,
                      schema,
                      encoding,
                      skipValidation: true,
                    }),
                  );

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
                  // skip validation because its already occurred in the store method
                  .map((record) =>
                    encodeRecord({
                      record,
                      table,
                      schema,
                      encoding,
                      skipValidation: true,
                    }),
                  );

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
        for (const tableName of Object.keys(tables)) {
          storeCache[tableName] = {};
        }
        cacheSize = 0;
        cacheSizeBytes = 0;
      } else {
        for (const [tableName, tableStoreCache] of Object.entries(storeCache)) {
          for (const [key, { opIndex }] of Object.entries(tableStoreCache)) {
            if (opIndex < flushIndex) {
              const bytes = storeCache[tableName][key].bytes;
              delete storeCache[tableName][key];

              cacheSize--;
              cacheSizeBytes -= bytes;
            }
          }
        }
      }

      isCacheExhaustive = false;
    },
  }).add;

  return {
    findUnique: async ({
      tableName,
      id: _id,
    }: {
      tableName: string;
      id: UserId;
    }) => {
      const id = structuredClone(_id);
      const cacheKey = getCacheKey(id, tableName);

      const cacheEntry = storeCache[tableName][cacheKey];
      if (cacheEntry !== undefined) {
        cacheEntry.opIndex = totalCacheOps++;
        return structuredClone(cacheEntry.record);
      }

      // At this point if cache is exhaustive, findUnique will always return null
      const record = isCacheExhaustive
        ? null
        : await readonlyStore.findUnique({ tableName, id });

      // add "find" entry to cache
      storeCache[tableName][cacheKey] = {
        type: "find",
        opIndex: totalCacheOps++,
        bytes: 24,
        record,
      };

      cacheSize++;

      return structuredClone(record);
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
      id: _id,
      data = {},
    }: {
      tableName: string;
      id: UserId;
      data?: Omit<UserRecord, "id">;
    }) => {
      const id = structuredClone(_id);
      const cacheKey = getCacheKey(id, tableName);

      // Check cache truthiness, will be false if record is null.
      if (storeCache[tableName][cacheKey]?.record) {
        throw new UniqueConstraintError(
          `Unique constraint failed for '${tableName}.id'.`,
        );
      }

      // copy user-land record
      const record = structuredClone(data) as UserRecord;
      record.id = id;

      normalizeRecord(record, tableName);

      validateRecord({
        record,
        table: tables[tableName].table,
        schema,
      });

      const bytes = getBytesSize(record);

      storeCache[tableName][cacheKey] = {
        type: "insert",
        opIndex: totalCacheOps++,
        bytes,
        record,
      };

      cacheSizeBytes += bytes;
      cacheSize++;

      if (shouldFlush()) await flush(false);

      return structuredClone(record);
    },
    createMany: async ({
      tableName,
      data,
    }: {
      tableName: string;
      data: UserRecord[];
    }) => {
      for (const _record of data) {
        const cacheKey = getCacheKey(_record.id, tableName);

        // Check cache truthiness, will be false if record is null.
        if (storeCache[tableName][cacheKey]?.record) {
          throw new UniqueConstraintError(
            `Unique constraint failed for '${tableName}.id'.`,
          );
        }

        // copy user-land record
        const record = structuredClone(_record);

        normalizeRecord(record, tableName);

        validateRecord({
          record,
          table: tables[tableName].table,
          schema,
        });

        const bytes = getBytesSize(record);

        storeCache[tableName][cacheKey] = {
          type: "insert",
          opIndex: totalCacheOps++,
          bytes,
          record,
        };

        cacheSizeBytes += bytes;
      }

      cacheSize += data.length;

      if (shouldFlush()) await flush(false);

      const returnData = structuredClone(data);
      for (const row of data) {
        normalizeRecord(row, tableName);
      }
      return returnData;
    },
    update: async ({
      tableName,
      id: _id,
      data = {},
    }: {
      tableName: string;
      id: UserId;
      data?:
        | Partial<Omit<UserRecord, "id">>
        | ((args: { current: UserRecord }) => Partial<Omit<UserRecord, "id">>);
    }) => {
      const id = structuredClone(_id);
      const cacheKey = getCacheKey(id, tableName);

      let cacheEntry = storeCache[tableName][cacheKey];

      if (cacheEntry === undefined) {
        const record = isCacheExhaustive
          ? null
          : await readonlyStore.findUnique({ tableName, id });

        if (record === null) {
          throw new RecordNotFoundError(
            "No existing record was found with the specified ID",
          );
        }

        // Note: a "spoof" cache entry is created
        cacheEntry = {
          type: "update",
          opIndex: 0,
          bytes: 0,
          record,
        };

        storeCache[tableName][cacheKey] = cacheEntry;
      } else {
        if (cacheEntry.record === null) {
          throw new RecordNotFoundError(
            "No existing record was found with the specified ID",
          );
        }

        if (cacheEntry.type === "find") {
          // move cache entry to "update"
          (cacheEntry.type as Entry["type"]) = "update";
        }
      }

      const update =
        typeof data === "function"
          ? data({ current: structuredClone(cacheEntry.record!) })
          : data;

      // copy user-land record
      const record = cacheEntry.record!;
      for (const [key, value] of Object.entries(structuredClone(update))) {
        record[key] = value;
      }

      normalizeRecord(record, tableName);

      validateRecord({
        record,
        table: tables[tableName].table,
        schema,
      });

      const bytes = getBytesSize(record);

      cacheEntry.record = record;
      cacheEntry.opIndex = totalCacheOps++;
      cacheEntry.bytes = bytes;

      return structuredClone(record);
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
              encoding,
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
                const current = decodeRecord({
                  record: latestRow,
                  table,
                  encoding,
                });
                const updateObject = data({ current });
                // Here, `latestRow` is already encoded, so we need to exclude it from `encodeRow`.
                const updateRow = {
                  id: latestRow.id,
                  ...encodeRecord({
                    record: updateObject,
                    table,
                    schema,
                    encoding,
                    skipValidation: false,
                  }),
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

              return rows.map((row) =>
                decodeRecord({ record: row, table, encoding }),
              );
            },
          );

          rows.push(..._rows);

          if (_rows.length === 0) {
            break;
          } else {
            cursor = encodeField({
              value: _rows[_rows.length - 1].id,
              column: table.id,
              encoding,
            });
          }
        }

        return rows;
      } else {
        return db.wrap({ method: `${tableName}.updateMany` }, async () => {
          const updateRow = encodeRecord({
            record: data,
            table,
            schema,
            encoding,
            skipValidation: false,
          });

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
                    encoding,
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

          return rows.map((row) =>
            decodeRecord({ record: row, table, encoding }),
          );
        });
      }
    },
    upsert: async ({
      tableName,
      id: _id,
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
      const id = structuredClone(_id);
      const cacheKey = getCacheKey(id, tableName);

      let cacheEntry = storeCache[tableName][cacheKey];

      if (cacheEntry === undefined) {
        if (isCacheExhaustive === false) {
          const record = await readonlyStore.findUnique({ tableName, id });

          if (record !== null) {
            // Note: a "spoof" cache entry is created
            cacheEntry = {
              type: "update",
              opIndex: 0,
              bytes: 0,
              record,
            };
            storeCache[tableName][cacheKey] = cacheEntry;
          }

          // Note: an "insert" cache entry will be created if the record is null,
          // so don't need to create it here.
        }
      } else {
        if (cacheEntry.type === "find") {
          if (cacheEntry.record === null) {
            // cache entry will be moved to "insert"
            (cacheEntry.type as Entry["type"]) = "insert";
          } else {
            // move cache entry to "update"
            (cacheEntry.type as Entry["type"]) = "update";
          }
        }
      }

      // Check cache truthiness, will be false if record is null.
      if (cacheEntry?.record) {
        // update branch

        const _update =
          typeof update === "function"
            ? update({ current: structuredClone(cacheEntry.record) })
            : update;

        // copy user-land record
        const record = cacheEntry.record;
        for (const [key, value] of Object.entries(structuredClone(_update))) {
          record[key] = value;
        }

        normalizeRecord(record, tableName);

        validateRecord({
          record,
          table: tables[tableName].table,
          schema,
        });

        const bytes = getBytesSize(record);

        cacheEntry.record = record;
        cacheEntry.opIndex = totalCacheOps++;
        cacheEntry.bytes = bytes;

        return structuredClone(record);
      } else {
        // insert/create branch

        // copy user-land record
        const record = structuredClone(create) as UserRecord;
        record.id = id;

        normalizeRecord(record, tableName);

        validateRecord({
          record,
          table: tables[tableName].table,
          schema,
        });

        const bytes = getBytesSize(record);

        storeCache[tableName][cacheKey] = {
          type: "insert",
          opIndex: totalCacheOps++,
          bytes,
          record,
        };

        cacheSize++;
        cacheSizeBytes += bytes;

        if (shouldFlush()) await flush(false);

        return structuredClone(record);
      }
    },
    delete: async ({
      tableName,
      id: _id,
    }: {
      tableName: string;
      id: UserId;
    }) => {
      const id = structuredClone(_id);
      const cacheKey = getCacheKey(id, tableName);

      const cacheEntry = storeCache[tableName][cacheKey];

      const deleteFromDb = async () => {
        const table = (schema[tableName] as { table: Table }).table;

        const deletedRow = await db
          .withSchema(namespaceInfo.userNamespace)
          .deleteFrom(tableName)
          .where(
            "id",
            "=",
            encodeField({ value: id, column: table.id, encoding }),
          )
          .returning(["id"])
          .executeTakeFirst()
          .catch((err) => {
            throw parseStoreError(err, { id });
          });

        return !!deletedRow;
      };

      if (cacheEntry === undefined) {
        if (isCacheExhaustive) {
          return false;
        } else {
          return await deleteFromDb();
        }
      } else {
        // delete from cache
        const bytes = cacheEntry.bytes;
        delete storeCache[tableName][cacheKey];

        cacheSize--;
        cacheSizeBytes -= bytes;

        if (cacheEntry.record === null) {
          return false;
        } else {
          return await deleteFromDb();
        }
      }
    },
    flush,
  };
};

const getBytesSize = (value: UserRecord | UserColumn) => {
  // size of metadata
  let size = 16;

  if (typeof value === "number") {
    // p.float, p.int
    size += 8;
  } else if (typeof value === "string") {
    // p.hex, p.string, p.enum
    size += 2 * value.length;
  } else if (typeof value === "boolean") {
    // p.boolean
    size += 4;
  } else if (typeof value === "bigint") {
    // p.bigint
    size += 48;
  } else if (value === null || value === undefined) {
    size += 8;
  } else if (Array.isArray(value)) {
    for (const e of value) {
      size += getBytesSize(e);
    }
  } else {
    for (const col of Object.values(value)) {
      size += getBytesSize(col);
    }
  }

  return size;
};
