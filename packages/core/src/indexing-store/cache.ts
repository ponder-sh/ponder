import type { QB } from "@/database/queryBuilder.js";
import { getPartitionName, getPrimaryKeyColumns } from "@/drizzle/index.js";
import { getColumnCasing } from "@/drizzle/kit/index.js";
import { addErrorMeta, toErrorMeta } from "@/indexing/index.js";
import type { Common } from "@/internal/common.js";
import {
  CopyFlushError,
  DelayedInsertError,
  ShutdownError,
} from "@/internal/errors.js";
import type {
  CrashRecoveryCheckpoint,
  Event,
  SchemaBuild,
} from "@/internal/types.js";
import { dedupe } from "@/utils/dedupe.js";
import { prettyPrint } from "@/utils/print.js";
import { promiseAllSettledWithThrow } from "@/utils/promiseAllSettledWithThrow.js";
import { startClock } from "@/utils/timer.js";
import {
  type Table,
  getTableColumns,
  getTableName,
  isTable,
  or,
  sql,
} from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import copy from "pg-copy-streams";
import {
  getProfilePatternKey,
  recordProfilePattern,
  recoverProfilePattern,
} from "./profile.js";
import {
  getCacheKey,
  getPrimaryKeyCache,
  getWhereCondition,
  normalizeRow,
} from "./utils.js";

export type IndexingCache = {
  /**
   * Returns true if the cache has an entry for `table` with `key`.
   */
  has: (params: { table: Table; key: object }) => boolean;
  /**
   * Returns the entry for `table` with `key`.
   */
  get: (params: { table: Table; key: object }) =>
    | Row
    | null
    | Promise<Row | null>;
  /**
   * Sets the entry for `table` with `key` to `row`.
   */
  set: (params: {
    table: Table;
    key: object;
    row: Row;
    isUpdate: boolean;
  }) => Row;
  /**
   * Deletes the entry for `table` with `key`.
   */
  delete: (params: { table: Table; key: object }) => boolean | Promise<boolean>;
  /**
   * Writes all temporary data to the database.
   *
   * @param params.tableNames - If provided, only flush the tables in the set.
   */
  flush: (params?: { tableNames?: Set<string> }) => Promise<void>;
  /**
   * Predict and load rows that will be accessed in the next event batch.
   */
  prefetch: (params: { events: Event[] }) => Promise<void>;
  /**
   * Marks the cache as incomplete.
   */
  invalidate: () => void;
  /**
   * Deletes all entries from the cache.
   */
  clear: () => void;
  event: Event | undefined;
  qb: QB;
};

const SAMPLING_RATE = 10;
const PREDICTION_THRESHOLD = 0.25;
const LOW_BATCH_THRESHOLD = 20;

/**
 * Database row.
 *
 * @example
 * {
 *   "owner": "0x123",
 *   "spender": "0x456",
 *   "amount": 100n,
 * }
 */
export type Row = { [key: string]: unknown };
/**
 * Serialized primary key values for uniquely identifying a database row.
 *
 * @example
 * "0x123_0x456"
 */
type CacheKey = string;
/**
 * Event name.
 *
 * @example
 * "Erc20:Transfer"
 *
 * @example
 * "Erc20.mint()"
 */
type EventName = string;
/**
 * Recorded database access pattern.
 *
 * @example
 * {
 *   "owner": ["args", "from"],
 *   "spender": ["log", "address"],
 * }
 */
export type ProfilePattern = {
  [key: string]:
    | {
        type: "derived";
        value: string[];
        fn?: (value: unknown) => unknown;
      }
    | {
        type: "delimeter";
        values: { value: string[]; fn?: (value: unknown) => unknown }[];
        delimiter: string;
      };
};

/**
 * Serialized for uniquely identifying a {@link ProfilePattern}.
 *
 * @example
 * "{
 *   "owner": ["args", "from"],
 *   "spender": ["log", "address"],
 * }"
 */
type ProfileKey = string;
/**
 * Cache of database rows.
 */
type Cache = Map<
  Table,
  {
    cache: Map<CacheKey, Row | null>;
    /** Cached keys that were prefetched. */
    prefetched: Set<CacheKey>;
    /** Cached keys that were not prefetched but were accessed anyway. */
    spillover: Set<CacheKey>;
    /** `true` if the cache completely mirrors the database. */
    isCacheComplete: boolean;
    /**
     * Estimated size of the cache in bytes.
     *
     * Note: this stops getting updated once `isCacheComplete = false`.
     */
    bytes: number;
    /** Number of times `get` missed the cached and read from the database. */
    diskReads: number;
  }
>;
/**
 * Buffer of database rows that will be flushed to the database.
 */
type Buffer = Map<
  Table,
  Map<
    CacheKey,
    {
      row: Row;
      metadata: { event: Event | undefined };
    }
  >
>;
/**
 * Metadata about database access patterns for each event.
 */
type Profile = Map<
  EventName,
  Map<Table, Map<ProfileKey, { pattern: ProfilePattern; count: number }>>
>;

const getBytes = (value: unknown) => {
  let size = 0;

  if (typeof value === "number") {
    size += 8;
  } else if (typeof value === "string") {
    size += 2 * value.length;
  } else if (typeof value === "boolean") {
    size += 4;
  } else if (typeof value === "bigint") {
    size += 48;
  } else if (value === null || value === undefined) {
    size += 8;
  } else if (Array.isArray(value)) {
    size += 24; // NodeJs object overhead (3 * 8 bytes)

    for (const e of value) {
      // value + 8 bytes for the key
      size += getBytes(e) + 8;
    }
  } else {
    size += 24; // NodeJs object overhead (3 * 8 bytes)
    for (const col of Object.values(value)) {
      // value + 8 bytes for the key
      size += getBytes(col) + 8;
    }
  }

  return size;
};

const ESCAPE_REGEX = /([\\\b\f\n\r\t\v])/g;

export const getCopyText = (table: Table, rows: Row[]) => {
  let result = "";
  const columns = Object.entries(getTableColumns(table));
  for (let i = 0; i < rows.length; i++) {
    const isLastRow = i === rows.length - 1;
    const row = rows[i]!;
    for (let j = 0; j < columns.length; j++) {
      const isLastColumn = j === columns.length - 1;
      const [columnName, column] = columns[j]!;
      let value = row[columnName];
      if (isLastColumn) {
        if (value === null || value === undefined) {
          result += "\\N";
        } else {
          if (column.mapToDriverValue !== undefined) {
            value = column.mapToDriverValue(value);
            if (value === null || value === undefined) {
              result += "\\N";
            } else {
              result += `${String(value).replace(ESCAPE_REGEX, "\\$1")}`;
            }
          }
        }
      } else {
        if (value === null || value === undefined) {
          result += "\\N\t";
        } else {
          if (column.mapToDriverValue !== undefined) {
            value = column.mapToDriverValue(value);
          }
          if (value === null || value === undefined) {
            result += "\\N\t";
          } else {
            result += `${String(value).replace(ESCAPE_REGEX, "\\$1")}\t`;
          }
        }
      }
    }
    if (isLastRow === false) {
      result += "\n";
    }
  }

  return result;
};

export const getCopyHelper = (qb: QB, chainId?: number) => {
  if (qb.$dialect === "pglite") {
    return async (table: Table, text: string, includeSchema = true) => {
      const target = includeSchema
        ? `"${getTableConfig(table).schema ?? "public"}"."${chainId === undefined ? getTableName(table) : getPartitionName(table, chainId)}"`
        : `"${chainId === undefined ? getTableName(table) : getPartitionName(table, chainId)}"`;
      await qb.$client
        .query(`COPY ${target} FROM '/dev/blob'`, [], {
          blob: new Blob([text]),
        })
        // Note: `TransactionError` is applied because the query
        // uses the low-level `$client.query` method.
        .catch((error) => {
          throw new CopyFlushError(error.message);
        });
    };
  } else {
    return async (table: Table, text: string, includeSchema = true) => {
      const target = includeSchema
        ? `"${getTableConfig(table).schema ?? "public"}"."${chainId === undefined ? getTableName(table) : getPartitionName(table, chainId)}"`
        : `"${chainId === undefined ? getTableName(table) : getPartitionName(table, chainId)}"`;
      const copyStream = qb.$client.query(
        copy.from(`COPY ${target} FROM STDIN`),
      );

      await new Promise((resolve, reject) => {
        copyStream.on("finish", resolve);
        copyStream.on("error", reject);

        copyStream.write(text);
        copyStream.end();
      }).catch((error) => {
        throw new CopyFlushError(error.message);
      });
    };
  }
};

export const recoverBatchError = async <T>(
  values: T[],
  callback: (values: T[]) => Promise<unknown>,
): Promise<
  { status: "success" } | { status: "error"; error: Error; value: T }
> => {
  try {
    await callback(values);
    return { status: "success" };
  } catch (error) {
    if (values.length === 1) {
      return { status: "error", error: error as Error, value: values[0]! };
    }
    const left = values.slice(0, Math.floor(values.length / 2));
    const right = values.slice(Math.floor(values.length / 2));
    const resultLeft = await recoverBatchError(left, callback);
    if (resultLeft.status === "error") {
      return resultLeft;
    }
    const resultRight = await recoverBatchError(right, callback);
    if (resultRight.status === "error") {
      return resultRight;
    }
    return { status: "success" };
  }
};

export const createIndexingCache = ({
  common,
  schemaBuild: { schema },
  crashRecoveryCheckpoint,
  eventCount,
  chainId,
}: {
  common: Common;
  schemaBuild: Pick<SchemaBuild, "schema">;
  crashRecoveryCheckpoint: CrashRecoveryCheckpoint;
  eventCount: { [eventName: string]: number };
  chainId?: number;
}): IndexingCache => {
  let event: Event | undefined;
  let qb: QB = undefined!;

  const cache: Cache = new Map();
  const insertBuffer: Buffer = new Map();
  const updateBuffer: Buffer = new Map();
  /** Profiling data about access patterns for each event. */
  const profile: Profile = new Map();

  const tables = Object.values(schema).filter(isTable);
  const primaryKeyCache = getPrimaryKeyCache(tables);

  for (const table of tables) {
    cache.set(table, {
      cache: new Map(),
      prefetched: new Set(),
      spillover: new Set(),
      isCacheComplete: crashRecoveryCheckpoint === undefined,
      bytes: 0,
      diskReads: 0,
    });
    insertBuffer.set(table, new Map());
    updateBuffer.set(table, new Map());
  }

  return {
    has({ table, key }) {
      if (cache.get(table)!.isCacheComplete) return true;
      const ck = getCacheKey(table, key, primaryKeyCache);

      return (
        cache.get(table)!.cache.has(ck) ??
        insertBuffer.get(table)!.has(ck) ??
        updateBuffer.get(table)!.has(ck)
      );
    },
    async get({ table, key }) {
      if (
        event &&
        eventCount[event.eventCallback.name]! % SAMPLING_RATE === 1
      ) {
        if (profile.has(event.eventCallback.name) === false) {
          profile.set(event.eventCallback.name, new Map());
          for (const table of tables) {
            profile.get(event.eventCallback.name)!.set(table, new Map());
          }
        }

        const pattern = recordProfilePattern(
          event,
          table,
          key,
          Array.from(
            profile.get(event.eventCallback.name)!.get(table)!.values(),
          ).map(({ pattern }) => pattern),
          primaryKeyCache,
        );
        if (pattern) {
          const key = getProfilePatternKey(pattern);
          if (profile.get(event.eventCallback.name)!.get(table)!.has(key)) {
            profile.get(event.eventCallback.name)!.get(table)!.get(key)!
              .count++;
          } else {
            profile
              .get(event.eventCallback.name)!
              .get(table)!
              .set(key, { pattern, count: 1 });
          }
        }
      }

      const ck = getCacheKey(table, key, primaryKeyCache);
      // Note: order is important, it is an invariant that update entries
      // are prioritized over insert entries
      const bufferEntry =
        updateBuffer.get(table)!.get(ck) ?? insertBuffer.get(table)!.get(ck);

      if (bufferEntry) {
        common.metrics.ponder_indexing_cache_requests_total.inc({
          table: getTableName(table),
          type: cache.get(table)!.isCacheComplete ? "complete" : "hit",
        });
        return bufferEntry.row;
      }

      const entry = cache.get(table)!.cache.get(ck);

      if (entry !== undefined) {
        if (
          cache.get(table)!.prefetched.has(ck) === false &&
          cache.get(table)!.isCacheComplete === false
        ) {
          cache.get(table)!.spillover.add(ck);
        }

        common.metrics.ponder_indexing_cache_requests_total.inc({
          table: getTableName(table),
          type: cache.get(table)!.isCacheComplete ? "complete" : "hit",
        });
        return entry;
      }

      cache.get(table)!.diskReads++;

      if (cache.get(table)!.isCacheComplete) {
        common.metrics.ponder_indexing_cache_requests_total.inc({
          table: getTableName(table),
          type: "complete",
        });
        return null;
      }

      cache.get(table)!.spillover.add(ck);

      common.metrics.ponder_indexing_cache_requests_total.inc({
        table: getTableName(table),
        type: "miss",
      });

      const endClock = startClock();

      const result = await qb
        .wrap((db) =>
          db.select().from(table).where(getWhereCondition(table, key)),
        )
        .then((res) => (res.length === 0 ? null : res[0]!))
        .then((row) => {
          cache.get(table)!.cache.set(ck, row);

          // Note: the size is not recorded because it is not possible
          // to miss the cache when in the "full in-memory" mode

          return row;
        });

      common.metrics.ponder_indexing_cache_query_duration.observe(
        {
          table: getTableName(table),
          method: "find",
        },
        endClock(),
      );
      return result;
    },
    set({ table, key, row: _row, isUpdate }) {
      const row = normalizeRow(table, _row, isUpdate);
      const ck = getCacheKey(table, key, primaryKeyCache);

      if (isUpdate) {
        updateBuffer.get(table)!.set(ck, { row, metadata: { event } });
      } else {
        insertBuffer.get(table)!.set(ck, { row, metadata: { event } });
      }

      return row;
    },
    async delete({ table, key }) {
      const ck = getCacheKey(table, key, primaryKeyCache);

      const inInsertBuffer = insertBuffer.get(table)!.delete(ck);
      const inUpdateBuffer = updateBuffer.get(table)!.delete(ck);

      cache.get(table)!.cache.delete(ck);

      const inDb = await qb
        .wrap((db) =>
          db.delete(table).where(getWhereCondition(table, key)).returning(),
        )
        .then((result) => result.length > 0);

      return inInsertBuffer || inUpdateBuffer || inDb;
    },
    async flush({ tableNames } = {}) {
      const context = {
        logger: common.logger.child({ action: "flush_database_rows" }),
      };
      const flushEndClock = startClock();

      const copy = getCopyHelper(qb, chainId);

      const flushTable = async (table: Table) => {
        const shouldRecordBytes = cache.get(table)!.isCacheComplete;
        if (
          tableNames !== undefined &&
          tableNames.has(getTableName(table)) === false
        ) {
          return;
        }

        const tableCache = cache.get(table)!;

        const target =
          chainId === undefined
            ? getTableName(table)
            : getPartitionName(table, chainId);

        const insertValues = Array.from(insertBuffer.get(table)!.values());
        const updateValues = Array.from(updateBuffer.get(table)!.values());

        if (insertValues.length > 0) {
          const endClock = startClock();

          if (insertValues.length > LOW_BATCH_THRESHOLD) {
            const text = getCopyText(
              table,
              insertValues.map(({ row }) => row),
            );

            await new Promise(setImmediate);

            await copy(table, text);
          } else {
            await qb.wrap(
              (db) =>
                db.insert(table).values(insertValues.map(({ row }) => row)),
              context,
            );
          }

          common.metrics.ponder_indexing_cache_query_duration.observe(
            {
              table: getTableName(table),
              method: "flush",
            },
            endClock(),
          );

          let bytes = 0;
          for (const [key, entry] of insertBuffer.get(table)!) {
            if (shouldRecordBytes && tableCache.cache.has(key) === false) {
              bytes += getBytes(entry.row) + getBytes(key);
            }
            tableCache.cache.set(key, entry.row);
          }
          tableCache.bytes += bytes;
          insertBuffer.get(table)!.clear();

          await new Promise(setImmediate);
        }

        if (updateValues.length > 0) {
          const primaryKeys = getPrimaryKeyColumns(table);

          const endClock = startClock();

          if (updateValues.length > LOW_BATCH_THRESHOLD) {
            // Steps for flushing "update" entries:
            // 1. Create temp table
            // 2. Copy into temp table
            // 3. Update target table with data from temp

            const createTempTableQuery = `
              CREATE TEMP TABLE IF NOT EXISTS "${target}" 
              AS SELECT * FROM "${getTableConfig(table).schema ?? "public"}"."${target}"
              WITH NO DATA;`;

            const updateQuery = `
              UPDATE "${getTableConfig(table).schema ?? "public"}"."${target}" as target
              SET ${Object.values(getTableColumns(table))
                .map(
                  (column) =>
                    `"${getColumnCasing(
                      column,
                      "snake_case",
                    )}" = source."${getColumnCasing(column, "snake_case")}"`,
                )
                .join(",\n")}
              FROM "${target}" source
              WHERE ${primaryKeys
                .map(({ sql }) => `target."${sql}" = source."${sql}"`)
                .join(" AND ")};`;

            await qb.wrap((db) => db.execute(createTempTableQuery), context);

            const text = getCopyText(
              table,
              updateValues.map(({ row }) => row),
            );
            await new Promise(setImmediate);

            await copy(table, text, false);
            await qb.wrap((db) => db.execute(updateQuery), context);
            await qb.wrap(
              (db) => db.execute(`TRUNCATE TABLE "${target}"`),
              context,
            );
          } else {
            await qb.wrap(
              (db) =>
                db
                  .insert(table)
                  .values(updateValues.map(({ row }) => row))
                  .onConflictDoUpdate({
                    // @ts-ignore
                    target: primaryKeys.map(({ js }) => table[js]!),
                    set: Object.fromEntries(
                      Object.entries(getTableColumns(table)).map(
                        ([columnName, column]) => [
                          columnName,
                          sql.raw(
                            `excluded."${getColumnCasing(column, "snake_case")}"`,
                          ),
                        ],
                      ),
                    ),
                  }),
              context,
            );
          }

          common.metrics.ponder_indexing_cache_query_duration.observe(
            {
              table: getTableName(table),
              method: "flush",
            },
            endClock(),
          );

          let bytes = 0;
          for (const [key, entry] of updateBuffer.get(table)!) {
            if (shouldRecordBytes && tableCache.cache.has(key) === false) {
              bytes += getBytes(entry.row) + getBytes(key);
            }
            tableCache.cache.set(key, entry.row);
          }
          tableCache.bytes += bytes;
          updateBuffer.get(table)!.clear();

          await new Promise(setImmediate);
        }

        if (insertValues.length > 0 || updateValues.length > 0) {
          common.logger.debug({
            msg: "Wrote database rows",
            table: target,
            row_count: insertValues.length + updateValues.length,
            duration: flushEndClock(),
          });
        }
      };

      try {
        if (qb.$dialect === "postgres") {
          await qb.wrap((db) => db.execute("SAVEPOINT flush"), context);

          await promiseAllSettledWithThrow(
            Array.from(cache.keys()).map(flushTable),
          );

          await qb.wrap((db) => db.execute("RELEASE flush"), context);
        } else {
          // Note: pglite must run sequentially
          for (const table of cache.keys()) {
            await flushTable(table);
          }
        }
      } catch (_error) {
        let error = _error as Error;
        if (error instanceof ShutdownError || qb.$dialect === "pglite") {
          throw error;
        }

        // Note `isFlushRetry` is true when the previous flush failed. When `isFlushRetry` is false, this
        // function takes an optimized fast path, with support for small batch sizes. PGlite always takes
        // the fast path because it doesn't support delayed insert errors.

        await qb.wrap((db) => db.execute("ROLLBACK to flush"), context);

        for (const table of cache.keys()) {
          if (
            tableNames !== undefined &&
            tableNames.has(getTableName(table)) === false
          ) {
            continue;
          }

          const target =
            chainId === undefined
              ? getTableName(table)
              : getPartitionName(table, chainId);

          const insertValues = Array.from(insertBuffer.get(table)!.values());
          const updateValues = Array.from(updateBuffer.get(table)!.values());

          if (insertValues.length > 0) {
            const endClock = startClock();

            await qb.wrap((db) => db.execute("SAVEPOINT flush"), context);

            const result = await recoverBatchError(
              insertValues,
              async (values) => {
                await qb.wrap((db) => db.execute("ROLLBACK to flush"), context);
                const text = getCopyText(
                  table,
                  values.map(({ row }) => row),
                );
                await copy(table, text);

                await qb.wrap((db) => db.execute("SAVEPOINT flush"), context);
              },
            );

            if (result.status === "error") {
              error = new DelayedInsertError(result.error.message);
              error.stack = undefined;

              addErrorMeta(
                error,
                `db.insert arguments:\n${prettyPrint(result.value.row)}`,
              );

              if (result.value.metadata.event) {
                addErrorMeta(error, toErrorMeta(result.value.metadata.event));

                common.logger.warn({
                  msg: "Failed to write cached database rows",
                  event: result.value.metadata.event.eventCallback.name,
                  type: "insert",
                  table: getTableName(table),
                  row_count: insertValues.length,
                  duration: endClock(),
                  error,
                });
              } else {
                common.logger.warn({
                  msg: "Failed to write cached database rows",
                  type: "insert",
                  table: getTableName(table),
                  row_count: insertValues.length,
                  duration: endClock(),
                  error,
                });
              }

              throw error;
            }
          }

          if (updateValues.length > 0) {
            // Steps for flushing "update" entries:
            // 1. Create temp table
            // 2. Copy into temp table
            // 3. Update target table with data from temp

            const createTempTableQuery = `
              CREATE TEMP TABLE IF NOT EXISTS "${target}"
              AS SELECT * FROM "${getTableConfig(table).schema ?? "public"}"."${target}"
              WITH NO DATA;
            `;

            const endClock = startClock();

            await qb.wrap((db) => db.execute(createTempTableQuery), context);
            await qb.wrap((db) => db.execute("SAVEPOINT flush"), context);

            const result = await recoverBatchError(
              updateValues,
              async (values) => {
                await qb.wrap((db) => db.execute("ROLLBACK to flush"), context);
                const text = getCopyText(
                  table,
                  values.map(({ row }) => row),
                );
                await copy(table, text, false);

                await qb.wrap((db) => db.execute("SAVEPOINT flush"), context);
              },
            );

            await qb.wrap(
              (db) => db.execute(`TRUNCATE TABLE "${target}"`),
              context,
            );

            if (result.status === "error") {
              error = new DelayedInsertError(result.error.message);
              error.stack = undefined;

              addErrorMeta(
                error,
                `db.update arguments:\n${prettyPrint(result.value.row)}`,
              );

              if (result.value.metadata.event) {
                addErrorMeta(error, toErrorMeta(result.value.metadata.event));

                common.logger.warn({
                  msg: "Failed to write cached database rows",
                  event: result.value.metadata.event.eventCallback.name,
                  type: "update",
                  table: getTableName(table),
                  row_count: updateValues.length,
                  duration: endClock(),
                  error,
                });
              } else {
                common.logger.warn({
                  msg: "Failed to write cached database rows",
                  type: "update",
                  table: getTableName(table),
                  row_count: updateValues.length,
                  duration: endClock(),
                  error,
                });
              }

              throw error;
            }
          }
        }

        // Note: if we weren't able to find the exact row that caused the error,
        // throw the original error.
        throw error;
      }
    },
    async prefetch({ events }) {
      const context = {
        logger: common.logger.child({ action: "prefetch_database_rows" }),
      };

      let totalBytes = 0;
      for (const table of tables) {
        totalBytes += cache.get(table)!.bytes;
      }

      // If data from the cache needs to be evicted, start with the
      // table with the least disk reads.

      if (totalBytes > common.options.indexingCacheMaxBytes) {
        for (const table of tables.sort(
          (a, b) => cache.get(a)!.diskReads - cache.get(b)!.diskReads,
        )) {
          if (cache.get(table)!.isCacheComplete === false) continue;

          totalBytes -= cache.get(table)!.bytes;

          cache.get(table)!.bytes = 0;
          cache.get(table)!.cache.clear();
          cache.get(table)!.isCacheComplete = false;
          // Note: spillover is not cleared because it is an invariant
          // it is empty

          common.logger.debug({
            msg: "Evicted cached database rows",
            table: getTableName(table),
            row_count: cache.get(table)!.cache.size,
          });

          if (totalBytes < common.options.indexingCacheMaxBytes) break;
        }
      }

      if (tables.every((table) => cache.get(table)!.isCacheComplete)) {
        return;
      }

      // Use historical accesses + next event batch to determine which
      // rows are going to be accessed, and preload them into the cache.

      const prediction = new Map<Table, Map<CacheKey, Row>>();

      for (const table of tables) {
        prediction.set(table, new Map());
      }

      for (const event of events) {
        if (profile.has(event.eventCallback.name)) {
          for (const table of tables) {
            if (cache.get(table)!.isCacheComplete) continue;
            for (const [, { count, pattern }] of profile
              .get(event.eventCallback.name)!
              .get(table)!) {
              // Expected value of times the prediction will be used.
              const ev =
                (count * SAMPLING_RATE) / eventCount[event.eventCallback.name]!;
              if (ev > PREDICTION_THRESHOLD) {
                const row = recoverProfilePattern(pattern, event);
                const key = getCacheKey(table, row, primaryKeyCache);
                prediction.get(table)!.set(key, row);
              }
            }
          }
        }
      }

      for (const [table, tableCache] of cache) {
        if (cache.get(table)!.isCacheComplete) continue;
        for (const key of tableCache.cache.keys()) {
          if (
            tableCache.spillover.has(key) ||
            prediction.get(table)!.has(key)
          ) {
            prediction.get(table)!.delete(key);
          } else {
            tableCache.cache.delete(key);
          }
        }
      }

      for (const table of tables) {
        cache.get(table)!.spillover.clear();
        cache.get(table)!.prefetched.clear();
      }

      for (const [table, tablePredictions] of prediction) {
        common.metrics.ponder_indexing_cache_requests_total.inc(
          {
            table: getTableName(table),
            type: "prefetch",
          },
          tablePredictions.size,
        );
      }

      await Promise.all(
        Array.from(prediction.entries())
          .filter(([, tablePredictions]) => tablePredictions.size > 0)
          .map(async ([table, tablePredictions]) => {
            for (const [key] of tablePredictions) {
              cache.get(table)!.prefetched.add(key);
            }

            const conditions = dedupe(
              Array.from(tablePredictions),
              ([key]) => key,
            ).map(([, prediction]) => getWhereCondition(table, prediction));

            if (conditions.length === 0) return;
            const endClock = startClock();

            await qb
              .wrap(
                (db) =>
                  db
                    .select()
                    .from(table)
                    .where(or(...conditions)),
                context,
              )
              .then((results) => {
                const resultsPerKey = new Map<CacheKey, Row>();
                for (const result of results) {
                  const ck = getCacheKey(table, result, primaryKeyCache);
                  resultsPerKey.set(ck, result);
                }

                const tableCache = cache.get(table)!;
                for (const key of tablePredictions.keys()) {
                  if (resultsPerKey.has(key)) {
                    tableCache.cache.set(key, resultsPerKey.get(key)!);
                  } else {
                    tableCache.cache.set(key, null);
                  }
                }

                common.logger.debug({
                  msg: "Pre-queried database rows",
                  table: getTableName(table),
                  row_count: results.length,
                  duration: endClock(),
                });
              });

            common.metrics.ponder_indexing_cache_query_duration.observe(
              {
                table: getTableName(table),
                method: "load",
              },
              endClock(),
            );
          }),
      );
    },
    invalidate() {
      for (const tableCache of cache.values()) {
        tableCache.isCacheComplete = false;
      }
    },
    clear() {
      for (const tableCache of cache.values()) {
        tableCache.cache.clear();
        tableCache.spillover.clear();
      }

      for (const tableBuffer of insertBuffer.values()) {
        tableBuffer.clear();
      }

      for (const tableBuffer of updateBuffer.values()) {
        tableBuffer.clear();
      }
    },
    set event(_event: Event | undefined) {
      event = _event;
    },
    set qb(_qb: QB) {
      qb = _qb;
    },
  };
};
