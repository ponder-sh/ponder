import type { Common } from "@/common/common.js";
import {
  FlushError,
  RecordNotFoundError,
  UniqueConstraintError,
} from "@/common/errors.js";
import type { HeadlessKysely } from "@/database/kysely.js";
import type { NamespaceInfo } from "@/database/service.js";
import type { Schema, Table } from "@/schema/common.js";
import {
  getTables,
  isMaterialColumn,
  isReferenceColumn,
  isScalarColumn,
} from "@/schema/utils.js";
import type {
  DatabaseRecord,
  DatabaseValue,
  UserId,
  UserRecord,
  UserValue,
} from "@/types/schema.js";
import { createQueue } from "@ponder/common";
import { sql } from "kysely";
import { type Hex, padHex } from "viem";
import type {
  HistoricalStore,
  OrderByInput,
  ReadonlyStore,
  WhereInput,
} from "./store.js";
import {
  decodeRecord,
  encodeRecord,
  encodeValue,
  validateRecord,
} from "./utils/encoding.js";
import { parseStoreError } from "./utils/errors.js";
import { buildWhereConditions } from "./utils/filter.js";

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

/**
 * Cache entries that mirror the database. Can be `null`,
 * meaning the entry doesn't exist in the cache.
 */
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
  readonlyStore,
  namespaceInfo,
  db,
  common,
  isCacheExhaustive: _isCacheExhaustive,
}: {
  encoding: "sqlite" | "postgres";
  schema: Schema;
  readonlyStore: ReadonlyStore;
  namespaceInfo: NamespaceInfo;
  db: HeadlessKysely<any>;
  common: Common;
  isCacheExhaustive: boolean;
}): HistoricalStore => {
  const maxSizeBytes = common.options.indexingCacheMaxBytes;
  const storeCache: StoreCache = {};
  const tables = getTables(schema);

  common.logger.debug({
    service: "indexing",
    msg: `Using a ${Math.round(maxSizeBytes / (1024 * 1024))} MB indexing cache`,
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
    if (tables[tableName]!.table.id[" scalar"] === "hex")
      return normalizeHex(id as Hex);
    if (typeof id === "bigint") return `#Bigint.${id}`;
    return id;
  };

  /**
   * Updates a record as if it had been encoded, stored in the database,
   * and then decoded. This is required to normalize p.hex() column values
   * and nullable column values.
   */
  const normalizeRecord = (record: UserRecord, tableName: string) => {
    for (const [columnName, column] of Object.entries(
      tables[tableName]!.table,
    )) {
      // optional columns are null
      if (isMaterialColumn(column) && record[columnName] === undefined) {
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

  const flush = createQueue<void, { isFullFlush: boolean }>({
    concurrency: 1,
    initialStart: true,
    browser: false,
    worker: async ({ isFullFlush }: { isFullFlush: boolean }) => {
      const flushIndex =
        totalCacheOps -
        cacheSize * (1 - common.options.indexingCacheFlushRatio);

      await Promise.all(
        Object.entries(storeCache).map(async ([tableName, tableStoreCache]) => {
          const table = (schema[tableName] as { table: Table }).table;
          const cacheEntries = Object.values(tableStoreCache);
          const batchSize = Math.round(
            common.options.databaseMaxQueryParameters /
              Object.keys(table).length,
          );

          let insertRecords: UserRecord[];

          if (isFullFlush) {
            insertRecords = cacheEntries
              .filter(({ type }) => type === "insert")
              .map(({ record }) => record!);
          } else {
            insertRecords = cacheEntries
              .filter(
                ({ type, opIndex }) =>
                  type === "insert" && opIndex < flushIndex,
              )
              .map(({ record }) => record!);
          }

          if (insertRecords.length !== 0) {
            common.logger.debug({
              service: "indexing",
              msg: `Inserting ${insertRecords.length} cached '${tableName}' records into the database`,
            });

            for (
              let i = 0, len = insertRecords.length;
              i < len;
              i += batchSize
            ) {
              await db.wrap({ method: `${tableName}.flush` }, async () => {
                const _insertRecords = insertRecords
                  .slice(i, i + batchSize)
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
                  .values(_insertRecords)
                  .execute()
                  .catch((_error) => {
                    const error = _error as Error;
                    common.logger.error({
                      service: "indexing",
                      msg: "Internal error occurred while flushing cache. Please report this error here: https://github.com/ponder-sh/ponder/issues",
                    });
                    throw new FlushError(error.message);
                  });
              });
            }
          }

          // Exit early if the table only has an "id" column.
          if (Object.values(table).filter(isMaterialColumn).length === 1) {
            return;
          }

          let updateRecords: UserRecord[];

          if (isFullFlush) {
            updateRecords = cacheEntries
              .filter(({ type }) => type === "update")
              .map(({ record }) => record!);
          } else {
            updateRecords = cacheEntries
              .filter(
                ({ type, opIndex }) =>
                  type === "update" && opIndex < flushIndex,
              )
              .map(({ record }) => record!);
          }

          if (updateRecords.length !== 0) {
            common.logger.debug({
              service: "indexing",
              msg: `Updating ${updateRecords.length} cached '${tableName}' records in the database`,
            });

            for (
              let i = 0, len = updateRecords.length;
              i < len;
              i += batchSize
            ) {
              await db.wrap({ method: `${tableName}.flush` }, async () => {
                const _updateRecords = updateRecords
                  .slice(i, i + batchSize)
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
                  .values(_updateRecords)
                  .onConflict((oc) =>
                    oc.column("id").doUpdateSet((eb) =>
                      Object.entries(table).reduce<any>(
                        (acc, [colName, column]) => {
                          if (colName !== "id") {
                            if (isMaterialColumn(column)) {
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
                  .catch((_error) => {
                    const error = _error as Error;
                    common.logger.error({
                      service: "indexing",
                      msg: "Internal error occurred while flushing cache. Please report this error here: https://github.com/ponder-sh/ponder/issues",
                    });
                    throw new FlushError(error.message);
                  });
              });
            }
          }
        }),
      );

      if (isFullFlush) {
        for (const tableName of Object.keys(tables)) {
          storeCache[tableName] = {};
        }
        cacheSize = 0;
        cacheSizeBytes = 0;
      } else {
        for (const [tableName, tableStoreCache] of Object.entries(storeCache)) {
          for (const [key, { opIndex }] of Object.entries(tableStoreCache)) {
            if (opIndex < flushIndex) {
              const bytes = storeCache[tableName]![key]!.bytes;
              delete storeCache[tableName]![key];

              cacheSize--;
              cacheSizeBytes -= bytes;
            }
          }
        }
      }

      isCacheExhaustive = false;
    },
  }).add;

  const _findUnique = async ({
    tableName,
    id,
  }: {
    tableName: string;
    id: UserId;
  }) => {
    const table = tables[tableName]!.table;

    const encodedId = encodeValue({
      value: id,
      column: table.id,
      encoding,
    });

    const record = await db
      .withSchema(namespaceInfo.userNamespace)
      .selectFrom(tableName)
      .selectAll()
      .where("id", "=", encodedId)
      .executeTakeFirst();

    if (record === undefined) return null;

    return decodeRecord({ record, table, encoding });
  };

  return {
    findUnique: async ({
      tableName,
      id: _id,
    }: {
      tableName: string;
      id: UserId;
    }) => {
      if (shouldFlush()) await flush({ isFullFlush: false });

      return db.wrap({ method: `${tableName}.findUnique` }, async () => {
        const id = structuredClone(_id);
        const cacheKey = getCacheKey(id, tableName);

        const cacheEntry = storeCache[tableName]![cacheKey];
        if (cacheEntry !== undefined) {
          cacheEntry.opIndex = totalCacheOps++;
          return structuredClone(cacheEntry.record);
        }

        // At this point if cache is exhaustive, findUnique will always return null
        const record = isCacheExhaustive
          ? null
          : await _findUnique({ tableName, id });

        const bytes = getBytesSize(record);

        // add "find" entry to cache
        storeCache[tableName]![cacheKey] = {
          type: "find",
          opIndex: totalCacheOps++,
          bytes,
          record,
        };

        cacheSizeBytes += bytes;
        cacheSize++;

        return structuredClone(record);
      });
    },
    findMany: async (arg: {
      tableName: string;
      where?: WhereInput<any>;
      orderBy?: OrderByInput<any>;
      before?: string | null;
      after?: string | null;
      limit?: number;
    }) => {
      await flush({ isFullFlush: true });
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
      if (shouldFlush()) await flush({ isFullFlush: false });

      return db.wrap({ method: `${tableName}.create` }, async () => {
        const id = structuredClone(_id);
        const cacheKey = getCacheKey(id, tableName);

        // Check cache truthiness, will be false if record is null.
        if (storeCache[tableName]![cacheKey]?.record) {
          throw new UniqueConstraintError(
            `Unique constraint failed for '${tableName}.id'.`,
          );
        }

        // copy user-land record
        const record = structuredClone(data) as UserRecord;
        record.id = id;

        normalizeRecord(record, tableName);

        validateRecord({ record, table: tables[tableName]!.table, schema });

        const bytes = getBytesSize(record);

        storeCache[tableName]![cacheKey] = {
          type: "insert",
          opIndex: totalCacheOps++,
          bytes,
          record,
        };

        cacheSizeBytes += bytes;
        cacheSize++;

        return structuredClone(record);
      });
    },
    createMany: async ({
      tableName,
      data,
    }: {
      tableName: string;
      data: UserRecord[];
    }) => {
      if (shouldFlush()) await flush({ isFullFlush: false });

      return db.wrap({ method: `${tableName}.createMany` }, async () => {
        for (const _record of data) {
          const cacheKey = getCacheKey(_record.id, tableName);

          // Check cache truthiness, will be false if record is null.
          if (storeCache[tableName]![cacheKey]?.record) {
            throw new UniqueConstraintError(
              `Unique constraint failed for '${tableName}.id'.`,
            );
          }

          // copy user-land record
          const record = structuredClone(_record);

          normalizeRecord(record, tableName);

          validateRecord({ record, table: tables[tableName]!.table, schema });

          const bytes = getBytesSize(record);

          storeCache[tableName]![cacheKey] = {
            type: "insert",
            opIndex: totalCacheOps++,
            bytes,
            record,
          };

          cacheSizeBytes += bytes;
        }

        cacheSize += data.length;

        const returnData = structuredClone(data);
        for (const record of data) {
          normalizeRecord(record, tableName);
        }
        return returnData;
      });
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
      if (shouldFlush()) await flush({ isFullFlush: false });

      return db.wrap({ method: `${tableName}.findUnique` }, async () => {
        const id = structuredClone(_id);
        const cacheKey = getCacheKey(id, tableName);

        let cacheEntry = storeCache[tableName]![cacheKey];

        if (cacheEntry === undefined) {
          const record = isCacheExhaustive
            ? null
            : await _findUnique({ tableName, id });

          if (record === null) {
            throw new RecordNotFoundError(
              "No existing record was found with the specified ID",
            );
          }

          // Note: a "spoof" cache entry is created
          cacheEntry = { type: "update", opIndex: 0, bytes: 0, record };

          storeCache[tableName]![cacheKey] = cacheEntry;
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

        validateRecord({ record, table: tables[tableName]!.table, schema });

        const bytes = getBytesSize(record);

        cacheEntry.record = record;
        cacheEntry.opIndex = totalCacheOps++;
        cacheEntry.bytes = bytes;

        return structuredClone(record);
      });
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
      await flush({ isFullFlush: true });

      const table = (schema[tableName] as { table: Table }).table;

      if (typeof data === "function") {
        const query = db
          .withSchema(namespaceInfo.userNamespace)
          .selectFrom(tableName)
          .selectAll()
          .where((eb) => buildWhereConditions({ eb, where, table, encoding }))
          .orderBy("id", "asc");

        const records: UserRecord[] = [];
        let cursor: DatabaseValue = null;

        while (true) {
          const _records = await db.wrap(
            { method: `${tableName}.updateMany` },
            async () => {
              const latestRecords: DatabaseRecord[] = await query
                .limit(common.options.databaseMaxRowLimit)
                .$if(cursor !== null, (qb) => qb.where("id", ">", cursor))
                .execute();

              const records: DatabaseRecord[] = [];

              for (const latestRecord of latestRecords) {
                const current = decodeRecord({
                  record: latestRecord,
                  table,
                  encoding,
                });
                const updateObject = data({ current });
                // Here, `latestRecord` is already encoded, so we need to exclude it from `encodeRecord`.
                const updateRecord = {
                  id: latestRecord.id,
                  ...encodeRecord({
                    record: updateObject,
                    table,
                    schema,
                    encoding,
                    skipValidation: false,
                  }),
                };

                const record = await db
                  .withSchema(namespaceInfo.userNamespace)
                  .updateTable(tableName)
                  .set(updateRecord)
                  .where("id", "=", latestRecord.id)
                  .returningAll()
                  .executeTakeFirstOrThrow()
                  .catch((err) => {
                    throw parseStoreError(err, updateObject);
                  });
                records.push(record);
              }

              return records.map((record) =>
                decodeRecord({ record, table, encoding }),
              );
            },
          );

          records.push(..._records);

          if (_records.length === 0) {
            break;
          } else {
            cursor = encodeValue({
              value: _records[_records.length - 1]!.id,
              column: table.id,
              encoding,
            });
          }
        }

        return records;
      } else {
        return db.wrap({ method: `${tableName}.updateMany` }, async () => {
          const updateRecord = encodeRecord({
            record: data,
            table,
            schema,
            encoding,
            skipValidation: false,
          });

          const records = await db
            .with("latestRows(id)", (db) =>
              db
                .withSchema(namespaceInfo.userNamespace)
                .selectFrom(tableName)
                .select("id")
                .where((eb) =>
                  buildWhereConditions({ eb, where, table, encoding }),
                ),
            )
            .withSchema(namespaceInfo.userNamespace)
            .updateTable(tableName)
            .set(updateRecord)
            .from("latestRows")
            .where(`${tableName}.id`, "=", sql.ref("latestRows.id"))
            .returningAll()
            .execute()
            .catch((err) => {
              throw parseStoreError(err, data);
            });

          return records.map((record) =>
            decodeRecord({ record, table, encoding }),
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
      if (shouldFlush()) await flush({ isFullFlush: false });

      return db.wrap({ method: `${tableName}.upsert` }, async () => {
        const id = structuredClone(_id);
        const cacheKey = getCacheKey(id, tableName);

        let cacheEntry = storeCache[tableName]![cacheKey];

        if (cacheEntry === undefined) {
          if (isCacheExhaustive === false) {
            const record = await _findUnique({ tableName, id });

            if (record !== null) {
              // Note: a "spoof" cache entry is created
              cacheEntry = { type: "update", opIndex: 0, bytes: 0, record };
              storeCache[tableName]![cacheKey] = cacheEntry;
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

          validateRecord({ record, table: tables[tableName]!.table, schema });

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

          validateRecord({ record, table: tables[tableName]!.table, schema });

          const bytes = getBytesSize(record);

          storeCache[tableName]![cacheKey] = {
            type: "insert",
            opIndex: totalCacheOps++,
            bytes,
            record,
          };

          cacheSize++;
          cacheSizeBytes += bytes;

          return structuredClone(record);
        }
      });
    },
    delete: async ({
      tableName,
      id: _id,
    }: {
      tableName: string;
      id: UserId;
    }) => {
      if (shouldFlush()) await flush({ isFullFlush: false });

      return db.wrap({ method: `${tableName}.delete` }, async () => {
        const id = structuredClone(_id);
        const cacheKey = getCacheKey(id, tableName);

        const cacheEntry = storeCache[tableName]![cacheKey];

        if (cacheEntry !== undefined) {
          // delete from cache
          const bytes = cacheEntry.bytes;
          delete storeCache[tableName]![cacheKey];
          cacheSize--;
          cacheSizeBytes -= bytes;
        }

        if (isCacheExhaustive || cacheEntry?.record === null) {
          return false;
        } else {
          const table = (schema[tableName] as { table: Table }).table;

          const deletedRecord = await db
            .withSchema(namespaceInfo.userNamespace)
            .deleteFrom(tableName)
            .where(
              "id",
              "=",
              encodeValue({ value: id, column: table.id, encoding }),
            )
            .returning(["id"])
            .executeTakeFirst()
            .catch((err) => {
              throw parseStoreError(err, { id });
            });

          return !!deletedRecord;
        }
      });
    },
    flush,
  };
};

const getBytesSize = (value: UserRecord | UserValue) => {
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
