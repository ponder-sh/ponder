import type { QB } from "@/database/queryBuilder.js";
import { getPrimaryKeyColumns } from "@/drizzle/index.js";
import { getColumnCasing } from "@/drizzle/kit/index.js";
import { addErrorMeta, toErrorMeta } from "@/indexing/index.js";
import type { Common } from "@/internal/common.js";
import {
  CopyFlushError,
  DelayedInsertError,
  RetryableError,
} from "@/internal/errors.js";
import type {
  CrashRecoveryCheckpoint,
  Event,
  PreBuild,
  SchemaBuild,
} from "@/internal/types.js";
import { dedupe } from "@/utils/dedupe.js";
import { prettyPrint } from "@/utils/print.js";
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

const ONE_YEAR = 31536000;
const ONE_MONTH = 2592000;
const ONE_WEEK = 604800;
const ONE_DAY = 86400;
const ONE_HOUR = 3600;
const ONE_MINUTE = 60;

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
    cache: Map<
      CacheKey,
      {
        row: Row | null;
        metadata?: {
          insertChainId?: number;
          insertBlockTimestamp?: number;
        };
      }
    >;
    /** Cached keys that were prefetched. */
    prefetched: Set<CacheKey>;
    /** Cached keys that were not prefetched but were accessed anyway. */
    spillover: Set<CacheKey>;
    /** `true` if the cache completely mirrors the database. */
    isCacheComplete: boolean;
    evictionPolicy: {
      ttl?: number;
      keepEvictedKeys?: boolean;
    };
    evictedKeys: Set<CacheKey>;
    /**
     * Estimated size of the cache in bytes.
     *
     * Note: this stops getting updated once `isCacheComplete = false`.
     */
    bytes: number;
    /** Number of times `get` missed the cached and read from the database. */
    diskReads: number;
    /** Access patterns for the table. */
    access: {
      nbHits: number;
      nbHitsNotExists: number;
      maxHitAge: number;
      cumulativeHitAge: bigint;
      inserts: Map<
        number,
        { nbInserts: number; cumulativeInsertTimestamp: bigint }
      >;
    };
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

const updateCacheAccessHit = (
  cache: Cache,
  table: Table,
  event: Event,
  insertBlockTimestamp: number | undefined,
) => {
  if (insertBlockTimestamp === undefined) {
    insertBlockTimestamp = 0;
  }
  const hitAge = Number(event.event.block.timestamp) - insertBlockTimestamp;
  const tableCacheAccess = cache.get(table)!.access;
  tableCacheAccess.nbHits++;
  tableCacheAccess.maxHitAge = Math.max(
    tableCacheAccess.maxHitAge,
    Number(hitAge),
  );
  tableCacheAccess.cumulativeHitAge += BigInt(hitAge);
};

const updateCacheAccessHitNotExists = (cache: Cache, table: Table) => {
  cache.get(table)!.access.nbHitsNotExists++;
};

const updateCacheAccessInsert = (
  cache: Cache,
  table: Table,
  insertChainId: number,
  insertBlockTimestamp: number,
) => {
  const inserts = cache.get(table)!.access.inserts.get(insertChainId);
  if (inserts) {
    inserts.nbInserts++;
    inserts.cumulativeInsertTimestamp += BigInt(insertBlockTimestamp);
  } else {
    cache.get(table)!.access.inserts.set(insertChainId, {
      nbInserts: 1,
      cumulativeInsertTimestamp: BigInt(insertBlockTimestamp),
    });
  }
};

const evictCache = (
  table: Table,
  cache: Cache,
  nowByChainId: Map<number, number>,
): number => {
  if (!cache.get(table)!.isCacheComplete) return 0;
  const evictionPolicy = cache.get(table)!.evictionPolicy;
  if (evictionPolicy.ttl === undefined) return 0;

  // Apply eviction policy
  let evictedBytes = 0;
  for (const [key, { row, metadata }] of cache.get(table)!.cache.entries()) {
    if (metadata?.insertBlockTimestamp) {
      const age =
        nowByChainId.get(metadata.insertChainId!)! -
        metadata.insertBlockTimestamp;
      if (age > evictionPolicy.ttl!) {
        // Subtract bytes when evicting cache entry
        const bytes = getBytes(row);
        cache.get(table)!.bytes -= bytes;
        evictedBytes += bytes;
        cache.get(table)!.cache.delete(key);
        // Keep evicted keys, to allow non-existing hits detection
        if (evictionPolicy.keepEvictedKeys) {
          cache.get(table)!.evictedKeys.add(key);
          cache.get(table)!.bytes += 40; // Set overhead
        } else {
          // Subtract key bytes
          const keyBytes = getBytes(key);
          cache.get(table)!.bytes -= keyBytes;
          evictedBytes += keyBytes;
        }
      }
    }
  }
  return evictedBytes;
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

export const getCopyHelper = (qb: QB) => {
  if (qb.$dialect === "pglite") {
    return async (table: Table, text: string, includeSchema = true) => {
      const target = includeSchema
        ? `"${getTableConfig(table).schema ?? "public"}"."${getTableName(
            table,
          )}"`
        : `"${getTableName(table)}"`;
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
        ? `"${getTableConfig(table).schema ?? "public"}"."${getTableName(
            table,
          )}"`
        : `"${getTableName(table)}"`;
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
  preBuild: { ordering },
  schemaBuild: { schema },
  crashRecoveryCheckpoint,
  eventCount,
}: {
  common: Common;
  preBuild: Pick<PreBuild, "ordering">;
  schemaBuild: Pick<SchemaBuild, "schema">;
  crashRecoveryCheckpoint: CrashRecoveryCheckpoint;
  eventCount: { [eventName: string]: number };
}): IndexingCache => {
  let event: Event | undefined;
  let qb: QB = undefined!;

  const cache: Cache = new Map();
  const insertBuffer: Buffer = new Map();
  const updateBuffer: Buffer = new Map();
  /** Profiling data about access patterns for each event. */
  const profile: Profile = new Map();

  let isFlushRetry = false;

  const tables = Object.values(schema).filter(isTable);
  const primaryKeyCache = getPrimaryKeyCache(tables);

  /** Note: with 'multichain' ordering, we need to ensure cache access tracking & eviction is processed by chain
   * as events are not chronologically ordered globally. */
  const cacheAccessByChain = ordering === "multichain";
  const lastBlockTimestampByChainId: Map<number, number> = new Map();

  for (const table of tables) {
    cache.set(table, {
      cache: new Map(),
      prefetched: new Set(),
      spillover: new Set(),
      isCacheComplete: crashRecoveryCheckpoint === undefined,
      bytes: 0,
      diskReads: 0,
      evictionPolicy: {
        ttl: undefined,
        keepEvictedKeys: undefined,
      },
      evictedKeys: new Set(),
      access: {
        nbHits: 0,
        nbHitsNotExists: 0,
        maxHitAge: 0,
        cumulativeHitAge: BigInt(0),
        inserts: new Map(),
      },
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
      if (event && eventCount[event.name]! % SAMPLING_RATE === 1) {
        if (profile.has(event.name) === false) {
          profile.set(event.name, new Map());
          for (const table of tables) {
            profile.get(event.name)!.set(table, new Map());
          }
        }

        const pattern = recordProfilePattern(
          event,
          table,
          key,
          Array.from(profile.get(event.name)!.get(table)!.values()).map(
            ({ pattern }) => pattern,
          ),
          primaryKeyCache,
        );
        if (pattern) {
          const key = getProfilePatternKey(pattern);
          if (profile.get(event.name)!.get(table)!.has(key)) {
            profile.get(event.name)!.get(table)!.get(key)!.count++;
          } else {
            profile
              .get(event.name)!
              .get(table)!
              .set(key, { pattern, count: 1 });
          }
        }
      }

      const shouldCollectCacheAccess = cache.get(table)!.isCacheComplete;

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

        if (shouldCollectCacheAccess && event) {
          // Get entity metadata from the cache (entity is always already in cache in case of update or insertOnConflict)
          const cacheEntry = cache.get(table)!.cache.get(ck);
          const insertTimestamp =
            cacheEntry?.metadata?.insertBlockTimestamp ??
            // Otherwise, for direct insert, we use the buffer metadata
            Number(bufferEntry.metadata.event?.event?.block?.timestamp ?? 0);

          updateCacheAccessHit(cache, table, event, insertTimestamp);
        }
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

        if (shouldCollectCacheAccess && event) {
          updateCacheAccessHit(
            cache,
            table,
            event,
            entry?.metadata?.insertBlockTimestamp,
          );
        }

        return entry.row;
      }

      cache.get(table)!.diskReads++;

      if (cache.get(table)!.isCacheComplete) {
        const evictionPolicy = cache.get(table)!.evictionPolicy;
        if (evictionPolicy.ttl === undefined) {
          common.metrics.ponder_indexing_cache_requests_total.inc({
            table: getTableName(table),
            type: "complete",
          });

          if (shouldCollectCacheAccess && event) {
            updateCacheAccessHitNotExists(cache, table);
          }

          return null;
        } else {
          const evictedKeys = cache.get(table)!.evictedKeys;
          // If the eviction policy is configured to keep evicted keys for this table
          if (evictionPolicy.keepEvictedKeys) {
            if (evictedKeys.has(ck)) {
              // This key was evicted due to TTL, but the entity might still exist in DB
              // Fall through to database query to check
            } else {
              // Key was never cached, so we can safely assume it doesn't exist
              common.metrics.ponder_indexing_cache_requests_total.inc({
                table: getTableName(table),
                type: "complete",
              });
              if (shouldCollectCacheAccess && event) {
                updateCacheAccessHitNotExists(cache, table);
              }
              return null;
            }
          } else {
            // keepEvictedKeys is false, so we can't distinguish between evicted and non-existent
            // Disable complete cache mode and fall back to database query
            cache.get(table)!.isCacheComplete = false;
            cache.get(table)!.bytes = 0;
            cache.get(table)!.cache.clear();
            cache.get(table)!.evictedKeys.clear();

            common.logger.debug({
              service: "indexing",
              msg: `Evicting '${getTableName(table)}' cache after miss evicted hit`,
            });
          }
        }
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
          cache.get(table)!.cache.set(ck, {
            row: structuredClone(row),
            // Note: we don't need metadata because complete/evicted cache is disabled if we missed a hit
          });

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
        updateBuffer.get(table)!.set(ck, {
          row: structuredClone(row),
          metadata: { event },
        });
      } else {
        insertBuffer.get(table)!.set(ck, {
          row: structuredClone(row),
          metadata: { event },
        });
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
      const copy = getCopyHelper(qb);

      // Note `isFlushRetry` is true when the previous flush failed. When `isFlushRetry` is false, this
      // function takes an optimized fast path, with support for small batch sizes. PGlite always takes
      // the fast path because it doesn't support delayed insert errors.

      if (isFlushRetry && qb.$dialect === "postgres") {
        for (const table of cache.keys()) {
          const shouldRecordBytes = cache.get(table)!.isCacheComplete;
          const shouldCollectCacheAccess = cache.get(table)!.isCacheComplete;

          if (
            tableNames !== undefined &&
            tableNames.has(getTableName(table)) === false
          ) {
            continue;
          }

          const tableCache = cache.get(table)!;

          const insertValues = Array.from(insertBuffer.get(table)!.values());
          const updateValues = Array.from(updateBuffer.get(table)!.values());

          if (insertValues.length > 0) {
            const endClock = startClock();

            await qb.wrap((db) => db.execute("SAVEPOINT flush"));

            try {
              const text = getCopyText(
                table,
                insertValues.map(({ row }) => row),
              );

              await new Promise(setImmediate);

              await copy(table, text);
            } catch (_error) {
              let error = _error as Error;
              const result = await recoverBatchError(
                insertValues,
                async (values) => {
                  await qb.wrap((db) => db.execute("ROLLBACK to flush"));
                  const text = getCopyText(
                    table,
                    values.map(({ row }) => row),
                  );
                  await copy(table, text);

                  await qb.wrap((db) => db.execute("SAVEPOINT flush"));
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
                    service: "indexing",
                    msg: `Error inserting into '${getTableName(table)}' in '${result.value.metadata.event.name}'`,
                    error,
                  });
                } else {
                  common.logger.warn({
                    service: "indexing",
                    msg: `Error inserting into '${getTableName(table)}'`,
                    error,
                  });
                }

                // @ts-ignore remove meta from error
                error.meta = undefined;
              } else {
                error.stack = undefined;

                common.logger.warn({
                  service: "indexing",
                  msg: `Error inserting into '${getTableName(table)}'`,
                  error,
                });
              }

              throw error;
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
              if (tableCache.cache.has(key)) {
                tableCache.cache.get(key)!.row = entry.row;
              } else {
                const insertBlockTimestamp = Number(
                  entry.metadata.event?.event?.block?.timestamp ?? 0,
                );
                const insertChainId = entry.metadata.event?.chainId!;
                tableCache.cache.set(key, {
                  row: entry.row,
                  metadata: {
                    insertBlockTimestamp,
                    insertChainId,
                  },
                });
                if (shouldCollectCacheAccess) {
                  updateCacheAccessInsert(
                    cache,
                    table,
                    insertChainId,
                    insertBlockTimestamp,
                  );
                }
                if (shouldRecordBytes) {
                  bytes += getBytes(entry.row) + getBytes(key);
                }
              }
            }
            tableCache.bytes += bytes;
            insertBuffer.get(table)!.clear();

            common.logger.debug({
              service: "database",
              msg: `Inserted ${insertValues.length} '${getTableName(table)}' rows`,
            });

            await new Promise(setImmediate);
          }

          if (updateValues.length > 0) {
            // Steps for flushing "update" entries:
            // 1. Create temp table
            // 2. Copy into temp table
            // 3. Update target table with data from temp

            const primaryKeys = getPrimaryKeyColumns(table);

            const createTempTableQuery = `
              CREATE TEMP TABLE IF NOT EXISTS "${getTableName(table)}"
              AS SELECT * FROM "${
                getTableConfig(table).schema ?? "public"
              }"."${getTableName(table)}"
              WITH NO DATA;
            `;
            const updateQuery = `
              UPDATE "${
                getTableConfig(table).schema ?? "public"
              }"."${getTableName(table)}" as target
              SET ${Object.values(getTableColumns(table))
                .map(
                  (column) =>
                    `"${getColumnCasing(
                      column,
                      "snake_case",
                    )}" = source."${getColumnCasing(column, "snake_case")}"`,
                )
                .join(",\n")}
              FROM "${getTableName(table)}" source
              WHERE ${primaryKeys
                .map(({ sql }) => `target."${sql}" = source."${sql}"`)
                .join(" AND ")};
            `;

            const endClock = startClock();

            await qb.wrap((db) => db.execute(createTempTableQuery));
            await qb.wrap((db) => db.execute("SAVEPOINT flush"));

            try {
              const text = getCopyText(
                table,
                updateValues.map(({ row }) => row),
              );

              await new Promise(setImmediate);

              await copy(table, text, false);
            } catch (_error) {
              let error = _error as Error;
              const result = await recoverBatchError(
                updateValues,
                async (values) => {
                  await qb.wrap((db) => db.execute("ROLLBACK to flush"));
                  const text = getCopyText(
                    table,
                    values.map(({ row }) => row),
                  );
                  await copy(table, text, false);

                  await qb.wrap((db) => db.execute("SAVEPOINT flush"));
                },
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
                    service: "indexing",
                    msg: `Error updating '${getTableName(table)}' in '${result.value.metadata.event.name}'`,
                    error,
                  });
                } else {
                  common.logger.warn({
                    service: "indexing",
                    msg: `Error updating '${getTableName(table)}'`,
                    error,
                  });
                }

                // @ts-ignore remove meta from error
                error.meta = undefined;
              } else {
                error.stack = undefined;

                common.logger.warn({
                  service: "indexing",
                  msg: `Error updating '${getTableName(table)}'`,
                  error,
                });
              }

              throw error;
            }

            await qb.wrap((db) => db.execute(updateQuery));
            await qb.wrap((db) =>
              db.execute(`TRUNCATE TABLE "${getTableName(table)}"`),
            );

            common.metrics.ponder_indexing_cache_query_duration.observe(
              {
                table: getTableName(table),
                method: "flush",
              },
              endClock(),
            );

            let bytes = 0;
            for (const [key, entry] of updateBuffer.get(table)!) {
              if (tableCache.cache.has(key)) {
                tableCache.cache.get(key)!.row = entry.row;
              } else {
                const insertBlockTimestamp = Number(
                  entry.metadata.event?.event?.block?.timestamp ?? 0,
                );
                const insertChainId = entry.metadata.event?.chainId!;
                tableCache.cache.set(key, {
                  row: entry.row,
                  metadata: { insertBlockTimestamp, insertChainId },
                });
                if (shouldCollectCacheAccess) {
                  updateCacheAccessInsert(
                    cache,
                    table,
                    insertChainId,
                    insertBlockTimestamp,
                  );
                }
                if (shouldRecordBytes) {
                  bytes += getBytes(entry.row) + getBytes(key);
                }
              }
            }
            tableCache.bytes += bytes;
            updateBuffer.get(table)!.clear();

            common.logger.debug({
              service: "database",
              msg: `Updated ${updateValues.length} '${getTableName(table)}' rows`,
            });

            await new Promise(setImmediate);
          }

          if (insertValues.length > 0 || updateValues.length > 0) {
            await qb.wrap((db) => db.execute("RELEASE flush"));
          }
        }
      } else {
        isFlushRetry = true;

        // Note: Must use `Promise.allSettled` to avoid short-circuiting while queries are running.

        const results = await Promise.allSettled(
          Array.from(cache.keys()).map(async (table) => {
            const shouldRecordBytes = cache.get(table)!.isCacheComplete;
            const shouldCollectCacheAccess = cache.get(table)!.isCacheComplete;
            if (
              tableNames !== undefined &&
              tableNames.has(getTableName(table)) === false
            ) {
              return;
            }

            const tableCache = cache.get(table)!;

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
                await qb.wrap((db) =>
                  db.insert(table).values(insertValues.map(({ row }) => row)),
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
                if (tableCache.cache.has(key)) {
                  tableCache.cache.get(key)!.row = entry.row;
                } else {
                  const insertBlockTimestamp = Number(
                    entry.metadata.event?.event?.block?.timestamp ?? 0,
                  );
                  const insertChainId = entry.metadata.event?.chainId!;
                  tableCache.cache.set(key, {
                    row: entry.row,
                    metadata: {
                      insertBlockTimestamp,
                      insertChainId,
                    },
                  });
                  if (shouldCollectCacheAccess) {
                    updateCacheAccessInsert(
                      cache,
                      table,
                      insertChainId,
                      insertBlockTimestamp,
                    );
                  }
                  if (shouldRecordBytes) {
                    bytes += getBytes(entry.row) + getBytes(key);
                  }
                }
              }
              tableCache.bytes += bytes;
              insertBuffer.get(table)!.clear();

              common.logger.debug({
                service: "database",
                msg: `Inserted ${insertValues.length} '${getTableName(table)}' rows`,
              });

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
                CREATE TEMP TABLE IF NOT EXISTS "${getTableName(table)}" 
                AS SELECT * FROM "${
                  getTableConfig(table).schema ?? "public"
                }"."${getTableName(table)}"
                WITH NO DATA;
              `;

                const updateQuery = `
                UPDATE "${
                  getTableConfig(table).schema ?? "public"
                }"."${getTableName(table)}" as target
                SET ${Object.values(getTableColumns(table))
                  .map(
                    (column) =>
                      `"${getColumnCasing(
                        column,
                        "snake_case",
                      )}" = source."${getColumnCasing(column, "snake_case")}"`,
                  )
                  .join(",\n")}
                FROM "${getTableName(table)}" source
                WHERE ${primaryKeys
                  .map(({ sql }) => `target."${sql}" = source."${sql}"`)
                  .join(" AND ")};
              `;

                await qb.wrap((db) => db.execute(createTempTableQuery));

                const text = getCopyText(
                  table,
                  updateValues.map(({ row }) => row),
                );

                await new Promise(setImmediate);

                await copy(table, text, false);

                await qb.wrap((db) => db.execute(updateQuery));

                await qb.wrap((db) =>
                  db.execute(`TRUNCATE TABLE "${getTableName(table)}"`),
                );
              } else {
                await qb.wrap((db) =>
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
                if (tableCache.cache.has(key)) {
                  tableCache.cache.get(key)!.row = entry.row;
                } else {
                  const insertBlockTimestamp = Number(
                    entry.metadata.event?.event?.block?.timestamp ?? 0,
                  );
                  const insertChainId = entry.metadata.event?.chainId!;
                  tableCache.cache.set(key, {
                    row: entry.row,
                    metadata: { insertBlockTimestamp, insertChainId },
                  });
                  if (shouldCollectCacheAccess) {
                    updateCacheAccessInsert(
                      cache,
                      table,
                      insertChainId,
                      insertBlockTimestamp,
                    );
                  }
                  if (shouldRecordBytes) {
                    bytes += getBytes(entry.row) + getBytes(key);
                  }
                }
              }
              tableCache.bytes += bytes;
              updateBuffer.get(table)!.clear();

              common.logger.debug({
                service: "database",
                msg: `Updated ${updateValues.length} '${getTableName(table)}' rows`,
              });

              await new Promise(setImmediate);
            }
          }),
        );

        if (results.some((result) => result.status === "rejected")) {
          const rejected = results.find(
            (result): result is PromiseRejectedResult =>
              result.status === "rejected",
          )!;
          throw new RetryableError(rejected.reason.message);
        }
      }

      isFlushRetry = false;
    },
    async prefetch({ events }) {
      const formatBytes = (bytes: number) => {
        return `${(bytes / 1024 / 1024).toFixed(2)}mb`;
      };
      // Apply eviction policy before calculating total bytes
      const nowByChainId: Map<number, number> = cacheAccessByChain
        ? lastBlockTimestampByChainId
        : new Map(
            Array.from(lastBlockTimestampByChainId.keys()).map((chainId) => [
              chainId,
              Number(event!.event.block.timestamp),
            ]),
          );

      for (const table of tables) {
        const evictedBytes = evictCache(table, cache, nowByChainId);
        console.log(
          `table=${getTableName(table)} size=${cache.get(table)!.cache.size} cacheBytes=${formatBytes(cache.get(table)!.bytes)} evictedBytes=${formatBytes(evictedBytes)} ttl=${cache.get(table)!.evictionPolicy.ttl} keepEvictedKeys=${cache.get(table)!.evictionPolicy.keepEvictedKeys} evictedKeys=${cache.get(table)!.evictedKeys.size}`,
        );
      }

      let totalBytes = 0;
      for (const table of tables) {
        totalBytes += cache.get(table)!.bytes;
      }
      const isCacheFull = totalBytes > common.options.indexingCacheMaxBytes;
      if (isCacheFull) {
        // Every time we reach the max cache size, we analyze the cache access patterns
        // to adjust the cache eviction policies.
        let evictedBytes = 0;
        for (const table of tables) {
          // Skip table if cache is not complete anymore
          if (!cache.get(table)!.isCacheComplete) continue;

          // Analyze table stats to determine if we can enable eviction policy
          const evictionPolicy = cache.get(table)!.evictionPolicy;
          let ttl: number | undefined;
          let keepEvictedKeys: boolean | undefined;

          // Inserts age are measured chain by chain to ensure compatibility
          // with "multichain" ordering, as events are not chronologically
          // ordered globally.
          let totalInserts = 0;
          let totalItemsAge = 0;

          for (const [chainId, inserts] of cache
            .get(table)!
            .access.inserts.entries()) {
            const now = cacheAccessByChain
              ? lastBlockTimestampByChainId.get(chainId)!
              : Number(event!.event.block.timestamp);
            const avgInsertTime =
              inserts.nbInserts > 0
                ? Number(inserts.cumulativeInsertTimestamp) / inserts.nbInserts
                : 0;
            const avgItemAge = now - avgInsertTime;

            console.log(
              `${getTableName(table)} - InsertStats - chainId=${chainId} nbInserts=${inserts.nbInserts} cumulativeInsertTimestamp=${inserts.cumulativeInsertTimestamp} now=${now} avgItemAge=${avgItemAge}`,
            );
            totalInserts += inserts.nbInserts;
            totalItemsAge += avgItemAge * inserts.nbInserts;
          }

          const avgItemAge =
            totalInserts > 0 ? totalItemsAge / totalInserts : 0;
          const avgHitAge =
            cache.get(table)!.access.nbHits > 0
              ? cache.get(table)!.access.cumulativeHitAge /
                BigInt(cache.get(table)!.access.nbHits)
              : 0n;
          const maxHitAge = cache.get(table)!.access.maxHitAge;
          const hitsPerEntries = cache.get(table)!.access.nbHits / totalInserts;
          const hitsNotExists = cache.get(table)!.access.nbHitsNotExists;

          // Note: hitAgeRatio is the main metric to determine the table profile
          // hitAgeRatio > 1 = items are accessed uniformly over a long time span (profile: dictionary, relational)
          // hitAgeRatio < 1 = items are accessed only over a short time span (profile: event, aggregation)
          const hitAgeRatio = maxHitAge / avgItemAge;

          console.log(
            `${getTableName(table)} - AccessStats - inserts: ${totalInserts} avgItemAge: ${avgItemAge} hits: ${cache.get(table)!.access.nbHits} avgHitAge: ${avgHitAge} maxHitAge: ${maxHitAge} hitAgeRatio: ${hitAgeRatio} hitsPerEntries: ${hitsPerEntries} hitsNotExists: ${hitsNotExists}`,
          );

          if (totalInserts < 1000) {
            // TableProfile = Dictionary: *low number of items*, high access rate, long access time span
          } else if (maxHitAge < ONE_MINUTE) {
            // TableProfile = Events: high number of items, low access rate, *very short access time span*
            ttl = Math.max(maxHitAge, ONE_MINUTE) * 1.5; // 1.5x maxHitAge, (min 1 minute)
            keepEvictedKeys = hitsNotExists > 0; // Keep evicted keys to resolve onConflict/find=>null patterns
          } else if (hitAgeRatio >= 1) {
            // TableProfile = Relational: medium number of items, high access rate, *long access time span*
          } else if (hitAgeRatio < 1) {
            // TableProfile = Aggregation: medium number of items, high access rate, *delimited access time span*
            keepEvictedKeys = hitsNotExists > 0; // Keep evicted keys to resolve onConflict/find=>null patterns

            // Round cache eviction to the above logical time interval: hour, day, week, month, year
            if (maxHitAge > ONE_YEAR || hitAgeRatio > 0.5) {
              // Don't enable cache eviction if:
              // - maxHitAge > ONE_YEAR: items are accessed over a too long time span
              // - hitAgeRatio > 0.5: items are not old enough for reliable eviction ttl (it will be determined on next limit hit)
              ttl = undefined;
            } else if (maxHitAge > ONE_MONTH) {
              ttl = ONE_YEAR;
            } else if (maxHitAge > ONE_WEEK) {
              ttl = ONE_MONTH;
            } else if (maxHitAge > ONE_DAY) {
              ttl = ONE_WEEK;
            } else if (maxHitAge > ONE_HOUR) {
              ttl = ONE_DAY;
            } else if (maxHitAge > ONE_MINUTE) {
              ttl = ONE_HOUR;
            } else {
              ttl = Math.max(maxHitAge, ONE_MINUTE) * 1.5; // 1.5x maxHitAge, (min 1 minute)
            }
          }

          cache.get(table)!.evictionPolicy = {
            ttl,
            keepEvictedKeys,
          };

          if (ttl !== undefined && ttl !== evictionPolicy.ttl) {
            common.logger.debug({
              service: "indexing",
              msg: `Updating eviction policy for '${getTableName(table)}' to ttl=${ttl} keepEvictedKeys=${keepEvictedKeys}`,
            });
            evictedBytes += evictCache(table, cache, nowByChainId);
          }
        }

        console.log(
          `Evicted ${evictedBytes} bytes from cache after applying new eviction policy`,
        );
        // If no data was evicted from eviction policy, we need to remove the least used table from the cache
        if (evictedBytes === 0) {
          // If data from the cache needs to be evicted, start with the
          // table with the least disk reads.
          for (const table of tables.sort(
            (a, b) => cache.get(a)!.diskReads - cache.get(b)!.diskReads,
          )) {
            if (cache.get(table)!.isCacheComplete === false) continue;

            common.logger.debug({
              service: "indexing",
              msg: `Evicting '${getTableName(table)}' table from cache`,
            });

            totalBytes -= cache.get(table)!.bytes;

            cache.get(table)!.isCacheComplete = false;
            cache.get(table)!.bytes = 0;
            cache.get(table)!.cache.clear();
            cache.get(table)!.evictedKeys.clear();
            // Note: spillover is not cleared because it is an invariant
            // it is empty

            if (totalBytes < common.options.indexingCacheMaxBytes) break;
          }
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
        if (profile.has(event.name)) {
          for (const table of tables) {
            if (cache.get(table)!.isCacheComplete) continue;
            for (const [, { count, pattern }] of profile
              .get(event.name)!
              .get(table)!) {
              // Expected value of times the prediction will be used.
              const ev = (count * SAMPLING_RATE) / eventCount[event.name]!;
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
              .wrap((db) =>
                db
                  .select()
                  .from(table)
                  .where(or(...conditions)),
              )
              .then((results) => {
                common.logger.debug({
                  service: "indexing",
                  msg: `Pre-queried ${results.length} '${getTableName(table)}' rows`,
                });
                const resultsPerKey = new Map<CacheKey, Row>();
                for (const result of results) {
                  const ck = getCacheKey(table, result, primaryKeyCache);
                  resultsPerKey.set(ck, result);
                }

                const tableCache = cache.get(table)!;
                for (const key of tablePredictions.keys()) {
                  if (resultsPerKey.has(key)) {
                    tableCache.cache.set(key, {
                      row: resultsPerKey.get(key)!,
                      // Note: we don't set metadata, because table is not complete or using eviction policy anymore
                    });
                  } else {
                    tableCache.cache.set(key, {
                      row: null,
                      // Note: we don't set metadata, because table is not complete or using eviction policy anymore
                    });
                  }
                }
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
        tableCache.bytes = 0;
        tableCache.cache.clear();
        tableCache.spillover.clear();
        tableCache.evictedKeys.clear();
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
      if (_event?.chainId) {
        lastBlockTimestampByChainId.set(
          _event?.chainId,
          Number(_event.event.block.timestamp),
        );
      }
    },
    set qb(_qb: QB) {
      qb = _qb;
    },
  };
};
