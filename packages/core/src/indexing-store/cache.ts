import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { QB } from "@/database/queryBuilder.js";
import { getPrimaryKeyColumns } from "@/drizzle/index.js";
import { getColumnCasing } from "@/drizzle/kit/index.js";
import { addErrorMeta, toErrorMeta } from "@/indexing/index.js";
import type { Common } from "@/internal/common.js";
import { CopyFlushError, DelayedInsertError } from "@/internal/errors.js";
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
  type Column,
  type Table,
  getTableColumns,
  getTableName,
  isTable,
  or,
} from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import copy from "pg-copy-streams";
import {
  getProfilePatternKey,
  recordProfilePattern,
  recoverProfilePattern,
} from "./profile.js";
import { getCacheKey, getWhereCondition, normalizeRow } from "./utils.js";

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
export type ProfilePattern = { [key: string]: string[] };
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
  Map<
    CacheKey,
    {
      row: Row | null;
      metadata?: {
        insertChainId?: number;
        insertBlockTimestamp?: number;
      };
    }
  >
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
 * Cache access statistics per table.
 */
type CacheAccess = Map<
  Table,
  {
    nbHits: number;
    nbHitsNotExists: number;
    maxHitAge: number;
    cumulativeHitAge: bigint;
    inserts: Map<
      number,
      { nbInserts: number; cumulativeInsertTimestamp: bigint }
    >;
  }
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
    for (const e of value) {
      size += getBytes(e);
    }
  } else {
    for (const col of Object.values(value)) {
      size += getBytes(col);
    }
  }

  return size;
};

const updateCacheAccessHit = (
  cacheAccess: CacheAccess,
  table: Table,
  event: Event,
  insertBlockTimestamp: number | undefined,
) => {
  if (insertBlockTimestamp === undefined) {
    insertBlockTimestamp = 0;
  }
  const hitAge = Number(event.event.block.timestamp) - insertBlockTimestamp;
  const tableCacheAccess = cacheAccess.get(table)!;
  tableCacheAccess.nbHits++;
  tableCacheAccess.maxHitAge = Math.max(
    tableCacheAccess.maxHitAge,
    Number(hitAge),
  );
  tableCacheAccess.cumulativeHitAge += BigInt(hitAge);
};

const updateCacheAccessHitNotExists = (
  cacheAccess: CacheAccess,
  table: Table,
) => {
  cacheAccess.get(table)!.nbHitsNotExists++;
};

const updateCacheAccessInsert = (
  cacheAccess: CacheAccess,
  table: Table,
  insertChainId: number,
  insertBlockTimestamp: number,
) => {
  const inserts = cacheAccess.get(table)!.inserts.get(insertChainId);
  if (inserts) {
    inserts.nbInserts++;
    inserts.cumulativeInsertTimestamp += BigInt(insertBlockTimestamp);
  } else {
    cacheAccess.get(table)!.inserts.set(insertChainId, {
      nbInserts: 1,
      cumulativeInsertTimestamp: BigInt(insertBlockTimestamp),
    });
  }
};

const ESCAPE_REGEX = /([\\\b\f\n\r\t\v])/g;

export const getCopyText = (table: Table, rows: Row[]) => {
  const columns = Object.entries(getTableColumns(table));
  const results = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const values = new Array(columns.length);
    for (let j = 0; j < columns.length; j++) {
      const [columnName, column] = columns[j]!;
      let value = row[columnName];
      if (value === null || value === undefined) {
        values[j] = "\\N";
      } else {
        if (column.mapToDriverValue !== undefined) {
          value = column.mapToDriverValue(value);
        }
        if (value === null || value === undefined) {
          values[j] = "\\N";
        } else {
          values[j] = String(value).replace(ESCAPE_REGEX, "\\$1");
        }
      }
    }
    results[i] = values.join("\t");
  }
  return results.join("\n");
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
      await pipeline(
        Readable.from(text),
        qb.$client.query(copy.from(`COPY ${target} FROM STDIN`)),
      )
        // Note: `TransactionError` is applied because the query
        // uses the low-level `$client.query` method.
        .catch((error) => {
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
  /**
   * Estimated size of the cache in bytes.
   *
   * Note: this stops getting updated once `isCacheComplete = false`.
   */
  let cacheBytes = 0;
  let event: Event | undefined;
  let qb: QB = undefined!;
  let isCacheComplete = crashRecoveryCheckpoint === undefined;
  const primaryKeyCache = new Map<Table, [string, Column][]>();

  let eventIndex = 0;
  const cache: Cache = new Map();
  const insertBuffer: Buffer = new Map();
  const updateBuffer: Buffer = new Map();
  /** Metadata about which entries in cache were not prefetched but were accessed anyway. */
  const spillover: Map<Table, Map<string, number>> = new Map();
  /** Profiling data about access patterns for each event. */
  const profile: Profile = new Map();
  /** Cache access statistics. */
  const cacheAccess: CacheAccess = new Map();
  /** Enabling virtual cache per table. */
  const virtualCacheConfig: Map<
    Table,
    {
      enabled: boolean;
      clearAfter?: number;
      keepEvictedKeys?: boolean;
    }
  > = new Map();
  const virtualCacheEvictedKeys: Map<Table, Set<CacheKey>> = new Map();
  /** With multichain ordering, we need to ensure cache eviction is processed by chain
   * as events are not chronologically ordered globally. */
  const virtualCacheEvictionByChain = ordering === "multichain";
  const lastBlockTimestampByChainId: Map<number, number> = new Map();

  const tables = Object.values(schema).filter(isTable);

  const cacheCompleteStart = Date.now();
  let cacheCompleteEnd: number | undefined = undefined;
  let cacheCompleteEvents = 0;

  let cachePartialStart = 0;
  let cachePartialEvents = 0;

  for (const table of tables) {
    cache.set(table, new Map());
    spillover.set(table, new Map());
    insertBuffer.set(table, new Map());
    updateBuffer.set(table, new Map());

    cacheAccess.set(table, {
      nbHits: 0,
      nbHitsNotExists: 0,
      maxHitAge: 0,
      cumulativeHitAge: 0n,
      inserts: new Map(),
    });

    virtualCacheConfig.set(table, { enabled: isCacheComplete });
    virtualCacheEvictedKeys.set(table, new Set());

    primaryKeyCache.set(table, []);
    for (const { js } of getPrimaryKeyColumns(table)) {
      // @ts-expect-error
      primaryKeyCache.get(table)!.push([js, table[js]!]);
    }
  }

  return {
    has({ table, key }) {
      if (isCacheComplete) return true;
      const ck = getCacheKey(table, key, primaryKeyCache);

      return (
        cache.get(table)!.has(ck) ??
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

      const isCacheVirtual = virtualCacheConfig.get(table)!.enabled;
      const shouldCollectCacheAccess = isCacheComplete || isCacheVirtual;

      const ck = getCacheKey(table, key, primaryKeyCache);

      if (
        getTableName(table) === "transaction" &&
        ck.includes(
          "0x24e027dff5c2d86dd27a1e5cca8853014300cd97b5644d4ca2a251d75bdf04ed",
        )
      ) {
        console.log(`VirtualCache: get ${getTableName(table)} ${ck}`);
      }

      // Note: order is important, it is an invariant that update entries
      // are prioritized over insert entries
      const bufferEntry =
        updateBuffer.get(table)!.get(ck) ?? insertBuffer.get(table)!.get(ck);

      if (bufferEntry) {
        common.metrics.ponder_indexing_cache_requests_total.inc({
          table: getTableName(table),
          type: isCacheComplete
            ? "complete"
            : isCacheVirtual
              ? "virtual"
              : "hit",
        });
        spillover.get(table)!.set(ck, eventIndex);
        if (shouldCollectCacheAccess && event) {
          // Original entity is always already in cache in case of update or insertOnConflict
          const cacheEntry = cache.get(table)!.get(ck);
          const insertTimestamp =
            cacheEntry?.metadata?.insertBlockTimestamp ??
            // Otherwise, for plain insert, we use the buffer insert block timestamp
            Number(bufferEntry.metadata.event?.event.block.timestamp);

          updateCacheAccessHit(cacheAccess, table, event, insertTimestamp);
        }

        if (
          getTableName(table) === "transaction" &&
          ck.includes(
            "0x24e027dff5c2d86dd27a1e5cca8853014300cd97b5644d4ca2a251d75bdf04ed",
          )
        ) {
          console.log(`VirtualCache: buffer hit ${getTableName(table)} ${ck}`);
        }

        return structuredClone(bufferEntry.row);
      }

      const entry = cache.get(table)!.get(ck);

      if (entry !== undefined) {
        common.metrics.ponder_indexing_cache_requests_total.inc({
          table: getTableName(table),
          type: isCacheComplete
            ? "complete"
            : isCacheVirtual
              ? "virtual"
              : "hit",
        });
        spillover.get(table)!.set(ck, eventIndex);

        if (shouldCollectCacheAccess && event) {
          updateCacheAccessHit(
            cacheAccess,
            table,
            event,
            entry?.metadata?.insertBlockTimestamp,
          );
        }

        if (
          getTableName(table) === "transaction" &&
          ck.includes(
            "0x24e027dff5c2d86dd27a1e5cca8853014300cd97b5644d4ca2a251d75bdf04ed",
          )
        ) {
          console.log(`VirtualCache: cache hit ${getTableName(table)} ${ck}`);
        }

        return structuredClone(entry.row);
      }

      if (isCacheComplete) {
        common.metrics.ponder_indexing_cache_requests_total.inc({
          table: getTableName(table),
          type: "complete",
        });
        if (shouldCollectCacheAccess && event) {
          updateCacheAccessHitNotExists(cacheAccess, table);
        }
        return null;
      }

      if (isCacheVirtual) {
        const conf = virtualCacheConfig.get(table)!;
        const evictedKeys = virtualCacheEvictedKeys.get(table)!;
        // We can safely detect non-existing hits
        if (
          // If virtual cache has no eviction
          conf.clearAfter === undefined ||
          // Or if the virtual cache is configured to keep evicted keys for this table
          (conf.keepEvictedKeys && !evictedKeys.has(ck))
        ) {
          if (
            getTableName(table) === "transaction" &&
            ck.includes(
              "0x24e027dff5c2d86dd27a1e5cca8853014300cd97b5644d4ca2a251d75bdf04ed",
            )
          ) {
            console.log(
              `VirtualCache: non-existing hit ${getTableName(table)} ${ck}`,
            );
          }

          common.metrics.ponder_indexing_cache_requests_total.inc({
            table: getTableName(table),
            type: "virtual",
          });
          if (shouldCollectCacheAccess && event) {
            updateCacheAccessHitNotExists(cacheAccess, table);
          }
          return null;
        }

        // Disable virtual cache for this table as soon as we miss a hit
        virtualCacheConfig.set(table, { enabled: false });
        virtualCacheEvictedKeys.set(table, new Set());

        console.log(
          `VirtualCache: disable ${getTableName(table)} after miss hit`,
        );
      }

      spillover.get(table)!.set(ck, eventIndex);

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
          cache.get(table)!.set(ck, {
            row: structuredClone(row),
            // Note: we don't need metadata because virtual cache is disabled if we miss the cache
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
      const ck = getCacheKey(table, key);

      const inInsertBuffer = insertBuffer.get(table)!.delete(ck);
      const inUpdateBuffer = updateBuffer.get(table)!.delete(ck);

      cache.get(table)!.delete(ck);

      const inDb = await qb
        .wrap((db) =>
          db.delete(table).where(getWhereCondition(table, key)).returning(),
        )
        .then((result) => result.length > 0);

      return inInsertBuffer || inUpdateBuffer || inDb;
    },
    async flush({ tableNames } = {}) {
      const copy = getCopyHelper(qb);

      const shouldRecordBytes = isCacheComplete;

      for (const table of cache.keys()) {
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
          } finally {
            common.metrics.ponder_indexing_cache_query_duration.observe(
              {
                table: getTableName(table),
                method: "flush",
              },
              endClock(),
            );
          }

          for (const [key, entry] of insertBuffer.get(table)!) {
            const isInCache = tableCache.has(key);
            if (shouldRecordBytes && isInCache === false) {
              cacheBytes += getBytes(entry.row);
            }
            if (isInCache) {
              tableCache.get(key)!.row = entry.row;
            } else {
              const insertBlockTimestamp = Number(
                entry.metadata.event?.event.block.timestamp,
              );
              const insertChainId = entry.metadata.event?.chainId!;
              tableCache.set(key, {
                row: entry.row,
                metadata: {
                  insertBlockTimestamp,
                  insertChainId,
                },
              });
              updateCacheAccessInsert(
                cacheAccess,
                table,
                insertChainId,
                insertBlockTimestamp,
              );
            }
          }
          insertBuffer.get(table)!.clear();

          common.logger.debug({
            service: "database",
            msg: `Inserted ${insertValues.length} '${getTableName(
              table,
            )}' rows`,
          });

          await new Promise(setImmediate);
        }

        if (updateValues.length > 0) {
          // Steps for flushing "update" entries:
          // 1. Create temp table
          // 2. Copy into temp table
          // 3. Update target table with data from temp

          const primaryKeys = getPrimaryKeyColumns(table);
          const set = Object.values(getTableColumns(table))
            .map(
              (column) =>
                `"${getColumnCasing(
                  column,
                  "snake_case",
                )}" = source."${getColumnCasing(column, "snake_case")}"`,
            )
            .join(",\n");

          const createTempTableQuery = `
              CREATE TEMP TABLE IF NOT EXISTS "${getTableName(table)}" 
              ON COMMIT DROP
              AS SELECT * FROM "${
                getTableConfig(table).schema ?? "public"
              }"."${getTableName(table)}"
              WITH NO DATA;
            `;
          const updateQuery = ` 
              WITH source AS (
                DELETE FROM "${getTableName(table)}"
                RETURNING *
              )
              UPDATE "${
                getTableConfig(table).schema ?? "public"
              }"."${getTableName(table)}" as target
              SET ${set}
              FROM source
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
          } finally {
            common.metrics.ponder_indexing_cache_query_duration.observe(
              {
                table: getTableName(table),
                method: "flush",
              },
              endClock(),
            );
          }

          await qb.wrap((db) => db.execute(updateQuery));

          common.metrics.ponder_indexing_cache_query_duration.observe(
            {
              table: getTableName(table),
              method: "flush",
            },
            endClock(),
          );

          for (const [key, entry] of updateBuffer.get(table)!) {
            const isInCache = tableCache.has(key);
            if (shouldRecordBytes && isInCache === false) {
              cacheBytes += getBytes(entry.row);
            }

            if (isInCache) {
              tableCache.get(key)!.row = entry.row;
            } else {
              const insertBlockTimestamp = Number(
                entry.metadata.event?.event.block.timestamp,
              );
              const insertChainId = entry.metadata.event?.chainId!;
              tableCache.set(key, {
                row: entry.row,
                metadata: { insertBlockTimestamp, insertChainId },
              });
              updateCacheAccessInsert(
                cacheAccess,
                table,
                insertChainId,
                insertBlockTimestamp,
              );
            }
          }
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
    },
    async prefetch({ events }) {
      eventIndex += events.length;

      const cacheSize = Array.from(cache.values()).reduce(
        (acc, tableCache) => acc + tableCache.size,
        0,
      );
      console.log(
        `indexingCache.prefetch() isCacheComplete=${isCacheComplete} cacheBytes=${
          cacheBytes / 1024 / 1024
        } / ${common.options.indexingCacheMaxBytes / 1024 / 1024} MB - cacheSize=${cacheSize} events=${
          events.length
        }`,
      );

      const cacheCompleteDuration =
        cacheCompleteEnd !== undefined
          ? (cacheCompleteEnd - cacheCompleteStart) / 1000
          : (Date.now() - cacheCompleteStart) / 1000;
      const cacheCompleteEps = Math.floor(
        cacheCompleteEvents / cacheCompleteDuration,
      );
      const cachePartialDuration =
        cachePartialStart !== 0 ? (Date.now() - cachePartialStart) / 1000 : 0;
      const cachePartialEps =
        cachePartialDuration !== 0
          ? Math.floor(cachePartialEvents / cachePartialDuration)
          : 0;
      console.log(
        `indexingCache.prefetch() cacheComplete: ${cacheCompleteEvents} in ${cacheCompleteDuration}s (${cacheCompleteEps} EPS) cachePartial: ${cachePartialEvents} in ${cachePartialDuration}s (${cachePartialEps} EPS)`,
      );

      if (isCacheComplete) {
        cacheCompleteEvents += events.length;
        if (cacheBytes < common.options.indexingCacheMaxBytes) {
          return;
        }

        isCacheComplete = false;
        cacheCompleteEnd = Date.now();
        cachePartialStart = Date.now();

        // Lookup to enable virtualCache per table depending on access patterns
        for (const [table, tableCacheAccess] of cacheAccess) {
          if (virtualCacheConfig.get(table)!.enabled === false) {
            // Virtual cache already disabled for this table
            // Empty cache
            cache.get(table)!.clear();
            continue;
          }

          // Analyze table stats to determine if we can enable virtual cache
          // and if we need to clear the cache after a certain age
          let enableVirtualCache: boolean;
          let clearAfter: number | undefined = undefined;
          let keepEvictedKeys: boolean | undefined = undefined;

          // Inserts age are measured chain by chain to ensure compatibility
          // with "multichain" ordering, as events are not chronologically
          // ordered globally.
          let totalInserts = 0;
          let totalItemsAge = 0;
          for (const [chainId, inserts] of tableCacheAccess.inserts.entries()) {
            totalInserts += inserts.nbInserts;
            const avgInsertTime =
              inserts.nbInserts > 0
                ? Number(inserts.cumulativeInsertTimestamp) / inserts.nbInserts
                : 0;
            const now = lastBlockTimestampByChainId.get(chainId)!;
            const avgItemAge = now - avgInsertTime;
            totalItemsAge += avgItemAge * inserts.nbInserts;
          }

          const avgItemAge =
            totalInserts > 0 ? totalItemsAge / totalInserts : 0;
          const avgHitAge =
            tableCacheAccess.nbHits > 0
              ? tableCacheAccess.cumulativeHitAge /
                BigInt(tableCacheAccess.nbHits)
              : 0n;
          const maxHitAge = tableCacheAccess.maxHitAge;
          const hitsPerEntries = tableCacheAccess.nbHits / totalInserts;

          const hitsNotExists = tableCacheAccess.nbHitsNotExists;
          const hitAgeRatio = maxHitAge / avgItemAge;
          // high hitAgeRatio (>1) means that cached items are accessed uniformly over a long time span
          // low hitAgeRatio (<1) means that cashed items are not accessed after a short time span

          console.log(
            `VirtualCache: profile ${getTableName(table)} - inserts: ${totalInserts} avgItemAge: ${avgItemAge} hits: ${tableCacheAccess.nbHits} avgHitAge: ${avgHitAge} maxHitAge: ${maxHitAge} hitAgeRatio: ${hitAgeRatio} hitsPerEntries: ${hitsPerEntries} hitsNotExists: ${hitsNotExists}`,
          );

          // TableProfile = Events: high number of items, low access rate, low hit age
          // TableProfile = Relational: medium number of items, high access rate, high hit age
          // TableProfile = Aggregation: medium number of items, high access rate, low hit age
          // TableProfile = Dictionary: low number of items, high access rate, high hit age

          if (totalInserts < 100) {
            // ToDo: Should be relative to table size in bytes
            // TableProfile = Dictionary
            enableVirtualCache = true;
            console.log(
              `VirtualCache: ${getTableName(table)} - Profile=Dictionary - enable: ${enableVirtualCache} clearAfter: ${clearAfter} keepEvictedKeys: ${keepEvictedKeys}`,
            );
          } else if (
            // ToDo: Should check table size in bytes
            avgHitAge < ONE_MINUTE && // 1 minute
            maxHitAge < ONE_MINUTE // 1 minute
          ) {
            // TableProfile = Events: high number of items, low access rate, low hit age
            enableVirtualCache = true;
            clearAfter = Math.max(maxHitAge, ONE_MINUTE) * 1.5; // 1.5x maxHitAge, (min 1 minute)
            keepEvictedKeys = hitsNotExists > 0;
            console.log(
              `VirtualCache: ${getTableName(table)} - Profile=Events - enable: ${enableVirtualCache} clearAfter: ${clearAfter} keepEvictedKeys: ${keepEvictedKeys}`,
            );
          } else if (hitsPerEntries > 2 && hitAgeRatio >= 1) {
            // TableProfile = Relational: medium number of items, high access rate, high hit age
            enableVirtualCache = true;
            console.log(
              `VirtualCache: ${getTableName(table)} - Profile=Relational - enable: ${enableVirtualCache} clearAfter: ${clearAfter} keepEvictedKeys: ${keepEvictedKeys}`,
            );
          } else if (hitsPerEntries > 2 && hitAgeRatio < 1) {
            // TableProfile = Aggregation: medium number of items, high access rate, low hit age
            enableVirtualCache = true;
            keepEvictedKeys = hitsNotExists > 0;

            // Round cache eviction to above interval bucket: hour, day, week, month, year
            if (maxHitAge > ONE_YEAR) {
              clearAfter = undefined; // above yearly access, disable cache eviction
            } else if (maxHitAge > ONE_MONTH) {
              clearAfter = ONE_YEAR;
            } else if (maxHitAge > ONE_WEEK) {
              clearAfter = ONE_MONTH;
            } else if (maxHitAge > ONE_DAY) {
              clearAfter = ONE_WEEK;
            } else if (maxHitAge > ONE_HOUR) {
              clearAfter = ONE_DAY;
            } else if (maxHitAge > ONE_MINUTE) {
              clearAfter = ONE_HOUR;
            } else {
              clearAfter = Math.max(maxHitAge, ONE_MINUTE) * 1.5; // 1.5x maxHitAge, (min 1 minute)
            }

            console.log(
              `VirtualCache: ${getTableName(table)} - Profile=Aggregation - enable: ${enableVirtualCache} clearAfter: ${clearAfter} keepEvictedKeys: ${keepEvictedKeys}`,
            );
          } else {
            enableVirtualCache = false;
            console.log(
              `VirtualCache: ${getTableName(table)} - Profile=Unknown - enable: ${enableVirtualCache}`,
            );
          }

          virtualCacheConfig.set(table, {
            enabled: enableVirtualCache,
            clearAfter,
            keepEvictedKeys,
          });
        }
      } else {
        cachePartialEvents += events.length;
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
            if (virtualCacheConfig.get(table)!.enabled) {
              // Skip predictions when virtual cache is enabled
              continue;
            }

            for (const [, { count, pattern }] of profile
              .get(event.name)!
              .get(table)!) {
              // Expected value of times the prediction will be used.
              const ev = (count * SAMPLING_RATE) / eventCount[event.name]!;
              if (ev > PREDICTION_THRESHOLD) {
                const row = recoverProfilePattern(pattern, event);
                const key = getCacheKey(table, row);
                prediction.get(table)!.set(key, row);
              }
            }
          }
        }
      }

      const cacheSizeBefore = Array.from(cache.values()).reduce(
        (acc, tableCache) => acc + tableCache.size,
        0,
      );

      for (const [table, tableCache] of cache) {
        const virtualCacheConf = virtualCacheConfig.get(table)!;

        for (const [key, { metadata }] of tableCache.entries()) {
          if (virtualCacheConf.enabled) {
            if (
              metadata?.insertBlockTimestamp &&
              virtualCacheConf.clearAfter !== undefined
            ) {
              const now = virtualCacheEvictionByChain
                ? lastBlockTimestampByChainId.get(metadata.insertChainId!)!
                : Number(event!.event.block.timestamp);
              const age = now - metadata.insertBlockTimestamp;
              if (age > virtualCacheConf.clearAfter!) {
                tableCache.delete(key);
                // Keep evicted keys, to allow non-existing hits detection
                if (virtualCacheConf.keepEvictedKeys) {
                  if (
                    getTableName(table) === "transaction" &&
                    key.includes(
                      "0x24e027dff5c2d86dd27a1e5cca8853014300cd97b5644d4ca2a251d75bdf04ed",
                    )
                  ) {
                    console.log(
                      `Evicting transaction - ${key} age=${age} clearAfter=${virtualCacheConf.clearAfter} - insertBlockTimestamp=${metadata.insertBlockTimestamp} - now=${now}`,
                    );
                  }
                  virtualCacheEvictedKeys.get(table)!.add(key);
                }
              }
            }
          } else {
            if (
              spillover.get(table)!.has(key) ||
              prediction.get(table)!.has(key)
            ) {
              prediction.get(table)!.delete(key);
            } else {
              tableCache.delete(key);
              isCacheComplete = false;
            }
          }
        }

        console.log(
          `indexingCache.prefetch() table=${getTableName(table)} size=${tableCache.size} virtual=${virtualCacheConf.enabled} clearAfter=${virtualCacheConf.clearAfter} keepEvictedKeys=${virtualCacheConf.keepEvictedKeys} evictedKeys=${virtualCacheEvictedKeys.get(table)!.size}`,
        );
      }
      const cacheSizeAfter = Array.from(cache.values()).reduce(
        (acc, tableCache) => acc + tableCache.size,
        0,
      );

      console.log(
        `indexingCache.prefetch() cacheSizeBefore=${cacheSizeBefore} cacheSizeAfter=${cacheSizeAfter} deleted=${cacheSizeAfter - cacheSizeBefore}`,
      );

      const spilloverSizeBefore = Array.from(spillover.values()).reduce(
        (acc, tableSpillover) => acc + tableSpillover.size,
        0,
      );
      for (const [table] of spillover) {
        // Keep spillover entries for the last 10k events
        for (const [key, spilloverEventIndex] of spillover
          .get(table)!
          .entries()) {
          if (spilloverEventIndex < eventIndex - 10_000) {
            spillover.get(table)!.delete(key);
          }
        }
      }
      const spilloverSizeAfter = Array.from(spillover.values()).reduce(
        (acc, tableSpillover) => acc + tableSpillover.size,
        0,
      );
      console.log(
        `indexingCache.prefetch() spilloverSizeBefore=${spilloverSizeBefore} spilloverSizeAfter=${spilloverSizeAfter} deleted=${spilloverSizeAfter - spilloverSizeBefore}`,
      );

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
                  msg: `Pre-queried ${results.length} / ${tablePredictions.size} '${getTableName(table)}' rows`,
                });
                const resultsPerKey = new Map<CacheKey, Row>();
                for (const result of results) {
                  const ck = getCacheKey(table, result, primaryKeyCache);
                  resultsPerKey.set(ck, result);
                }

                const tableCache = cache.get(table)!;
                for (const key of tablePredictions.keys()) {
                  if (resultsPerKey.has(key)) {
                    tableCache.set(key, {
                      row: resultsPerKey.get(key)!,
                      // Note: we don't set metadata, because table is not using virtual cache
                    });
                  } else {
                    tableCache.set(key, {
                      row: null,
                      // Note: we don't set metadata, because table is not using virtual cache
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
      isCacheComplete = false;
    },
    clear() {
      for (const tableCache of cache.values()) {
        tableCache.clear();
      }

      for (const tableSpillover of spillover.values()) {
        tableSpillover.clear();
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
