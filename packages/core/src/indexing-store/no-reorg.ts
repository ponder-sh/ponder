import type { Common } from "@/common/common.js";
import { UniqueConstraintError } from "@/common/errors.js";
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
} from "@/types/schema.js";
import { type Hex, padHex } from "viem";
import { type FindEntry, type Key, getBytesSize } from "./historical.js";
import type { WhereInput, WriteStore } from "./store.js";
import {
  decodeRecord,
  encodeRecord,
  encodeValue,
  validateRecord,
} from "./utils/encoding.js";
import { parseStoreError } from "./utils/errors.js";
import { buildWhereConditions } from "./utils/filter.js";

/**
 * An in-memory representation of the indexing store. Every entry is
 * normalized, validated, and guaranteed to not share any references
 * with user-land.
 */
type StoreCache = {
  [tableName: string]: { [key: Key]: Omit<FindEntry, "type"> };
};

export const getNoReorgStore = ({
  encoding,
  schema,
  namespaceInfo,
  db,
  common,
}: {
  encoding: "sqlite" | "postgres";
  schema: Schema;
  namespaceInfo: NamespaceInfo;
  db: HeadlessKysely<any>;
  common: Common;
}): WriteStore<"realtime"> => {
  const maxSizeBytes = common.options.indexingCacheMaxBytes;
  const storeCache: StoreCache = {};
  const tables = getTables(schema);

  common.logger.debug({
    service: "indexing",
    msg: `Using a ${Math.round(maxSizeBytes / (1024 * 1024))} MB indexing cache`,
  });

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

  const flush = () => {
    const flushIndex =
      totalCacheOps - cacheSize * (1 - common.options.indexingCacheFlushRatio);

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
  };

  return {
    create: ({
      tableName,
      id: _id,
      data = {},
    }: {
      tableName: string;
      id: UserId;
      data?: Omit<UserRecord, "id">;
    }) => {
      if (shouldFlush()) flush();

      const table = (schema[tableName] as { table: Table }).table;

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

        const bytes = getBytesSize(record);

        // Add to cache
        storeCache[tableName]![cacheKey] = {
          opIndex: totalCacheOps++,
          bytes,
          record,
        };

        // Add to database
        const createRecord = encodeRecord({
          record: { id, ...data },
          table,
          encoding,
          schema,
          skipValidation: false,
        });

        await db
          .withSchema(namespaceInfo.userNamespace)
          .insertInto(tableName)
          .values(createRecord)
          .executeTakeFirstOrThrow()
          .catch((err) => {
            throw parseStoreError(err, { id, ...data });
          });

        return record;
      });
    },
    createMany: ({
      tableName,
      data,
    }: {
      tableName: string;
      data: UserRecord[];
    }) => {
      const table = (schema[tableName] as { table: Table }).table;

      return db.wrap({ method: `${tableName}.createMany` }, async () => {
        const records: DatabaseRecord[] = [];

        const batchSize = Math.round(
          common.options.databaseMaxQueryParameters / Object.keys(table).length,
        );
        for (let i = 0, len = data.length; i < len; i += batchSize) {
          const createRecords = data.slice(i, i + batchSize).map((d) =>
            encodeRecord({
              record: d,
              table,
              encoding,
              schema,
              skipValidation: false,
            }),
          );

          const _records = await db
            .withSchema(namespaceInfo.userNamespace)
            .insertInto(tableName)
            .values(createRecords)
            .returningAll()
            .execute()
            .catch((err) => {
              throw parseStoreError(err, data.length > 0 ? data[0]! : {});
            });

          records.push(..._records);
        }

        return records.map((record) =>
          decodeRecord({ record, table, encoding }),
        );
      });
    },
    update: ({
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
      const table = (schema[tableName] as { table: Table }).table;

      return db.wrap({ method: `${tableName}.update` }, async () => {
        const encodedId = encodeValue({
          value: id,
          column: table.id,
          encoding,
        });

        const latestRecord = await db
          .withSchema(namespaceInfo.userNamespace)
          .selectFrom(tableName)
          .selectAll()
          .where("id", "=", encodedId)
          .executeTakeFirstOrThrow()
          .catch((err) => {
            throw parseStoreError(err, { id, data: "(function)" });
          });

        const updateObject =
          typeof data === "function"
            ? data({
                current: decodeRecord({
                  record: latestRecord,
                  table,
                  encoding,
                }),
              })
            : data;
        const updateRecord = encodeRecord({
          record: { id, ...updateObject },
          table,
          encoding,
          schema,
          skipValidation: false,
        });

        const record = await db
          .withSchema(namespaceInfo.userNamespace)
          .updateTable(tableName)
          .set(updateRecord)
          .where("id", "=", encodedId)
          .returningAll()
          .executeTakeFirstOrThrow()
          .catch((err) => {
            throw parseStoreError(err, { id, ...updateObject });
          });

        const result = decodeRecord({ record, table, encoding });

        return result;
      });
    },
    updateMany: async ({
      tableName,
      where,
      data = {},
    }: {
      tableName: string;
      encodedCheckpoint: string;
      where: WhereInput<any>;
      data?:
        | Partial<Omit<UserRecord, "id">>
        | ((args: { current: UserRecord }) => Partial<Omit<UserRecord, "id">>);
    }) => {
      const table = (schema[tableName] as { table: Table }).table;

      const records: UserRecord[] = [];
      let cursor: DatabaseValue = null;

      while (true) {
        const _records = await db.wrap(
          { method: `${tableName}.updateMany` },
          async () => {
            const latestRecords: DatabaseRecord[] = await db
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
              .orderBy("id", "asc")
              .limit(common.options.databaseMaxRowLimit)
              .$if(cursor !== null, (qb) => qb.where("id", ">", cursor))
              .execute();

            const records: DatabaseRecord[] = [];

            for (const latestRecord of latestRecords) {
              const updateObject =
                typeof data === "function"
                  ? data({
                      current: decodeRecord({
                        record: latestRecord,
                        table,
                        encoding,
                      }),
                    })
                  : data;

              // Here, `latestRecord` is already encoded, so we need to exclude it from `encodeRecord`.
              const updateRecord = {
                id: latestRecord.id,
                ...encodeRecord({
                  record: updateObject,
                  table,
                  encoding,
                  schema,
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
    },
    upsert: ({
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
      if (shouldFlush()) flush();

      const table = (schema[tableName] as { table: Table }).table;

      return db.wrap({ method: `${tableName}.upsert` }, async () => {
        const id = structuredClone(_id);
        const cacheKey = getCacheKey(id, tableName);

        let cacheEntry = storeCache[tableName]![cacheKey];

        const encodedId = encodeValue({
          value: id,
          column: table.id,
          encoding,
        });

        // Load entry into cache
        if (cacheEntry === undefined) {
          const record = await db
            .withSchema(namespaceInfo.userNamespace)
            .selectFrom(tableName)
            .selectAll()
            .where("id", "=", encodedId)
            .executeTakeFirst();

          cacheEntry = {
            opIndex: 0,
            bytes: 0,
            record: record ? decodeRecord({ record, table, encoding }) : null,
          };
          storeCache[tableName]![cacheKey] = cacheEntry;
        }

        const createRecord = encodeRecord({
          record: { id, ...create },
          table,
          encoding,
          schema,
          skipValidation: false,
        });

        // Check cache truthiness, will be false if record is null.
        if (cacheEntry?.record) {
          const updateObject =
            typeof update === "function"
              ? update({ current: structuredClone(cacheEntry.record) })
              : update;

          // copy user-land record, updating cache
          const record = cacheEntry.record;
          for (const [key, value] of Object.entries(
            structuredClone(updateObject),
          )) {
            record[key] = value;
          }

          normalizeRecord(record, tableName);

          validateRecord({ record, table: tables[tableName]!.table, schema });

          const bytes = getBytesSize(record);

          cacheEntry.record = record;
          cacheEntry.opIndex = totalCacheOps++;
          cacheEntry.bytes = bytes;

          // Update database
          const updateRecord = encodeRecord({
            record: { id, ...updateObject },
            table,
            encoding,
            schema,
            skipValidation: false,
          });

          await db
            .withSchema(namespaceInfo.userNamespace)
            .updateTable(tableName)
            .set(updateRecord)
            .where("id", "=", encodedId)
            .executeTakeFirstOrThrow()
            .catch((err) => {
              const prettyObject: any = { id };
              for (const [key, value] of Object.entries(create))
                prettyObject[`create.${key}`] = value;
              for (const [key, value] of Object.entries(updateObject))
                prettyObject[`update.${key}`] = value;
              throw parseStoreError(err, prettyObject);
            });
        } else {
          const record = structuredClone(create) as UserRecord;
          record.id = id;

          normalizeRecord(record, tableName);

          validateRecord({ record, table: tables[tableName]!.table, schema });

          const bytes = getBytesSize(record);

          // Update cache
          storeCache[tableName]![cacheKey] = {
            opIndex: totalCacheOps++,
            bytes,
            record,
          };

          cacheSize++;
          cacheSizeBytes += bytes;

          // Create in database
          await db
            .withSchema(namespaceInfo.userNamespace)
            .insertInto(tableName)
            .values(createRecord)

            .executeTakeFirstOrThrow()
            .catch((err) => {
              const prettyObject: any = { id };
              for (const [key, value] of Object.entries(create))
                prettyObject[`create.${key}`] = value;
              if (typeof update === "function") {
                prettyObject.update = "(function)";
              } else {
                for (const [key, value] of Object.entries(update))
                  prettyObject[`update.${key}`] = value;
              }
              throw parseStoreError(err, prettyObject);
            });
        }

        return structuredClone(storeCache[tableName]![cacheKey]!.record!);
      });
    },
    delete: ({
      tableName,
      id: _id,
    }: {
      tableName: string;
      id: UserId;
    }) => {
      if (shouldFlush()) flush();

      const table = (schema[tableName] as { table: Table }).table;

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

        // Exit early is record is not in database
        if (cacheEntry?.record === null) {
          return false;
        }

        const encodedId = encodeValue({
          value: id,
          column: table.id,
          encoding,
        });

        const deletedRecord = await db
          .withSchema(namespaceInfo.userNamespace)
          .deleteFrom(tableName)
          .where("id", "=", encodedId)
          .returning(["id"])
          .executeTakeFirst()
          .catch((err) => {
            throw parseStoreError(err, { id });
          });

        return !!deletedRecord;
      });
    },
  };
};
