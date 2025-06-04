import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { QB } from "@/database/queryBuilder.js";
import { getPrimaryKeyColumns } from "@/drizzle/index.js";
import { getColumnCasing } from "@/drizzle/kit/index.js";
import { addErrorMeta, toErrorMeta } from "@/indexing/index.js";
import type { Common } from "@/internal/common.js";
import { FlushError } from "@/internal/errors.js";
import type {
  CrashRecoveryCheckpoint,
  Event,
  SchemaBuild,
} from "@/internal/types.js";
import { dedupe } from "@/utils/dedupe.js";
import { prettyPrint } from "@/utils/print.js";
import { startClock } from "@/utils/timer.js";
import {
  type Column,
  type Table,
  type TableConfig,
  getTableColumns,
  getTableName,
  is,
  or,
  sql,
} from "drizzle-orm";
import {
  PgTable,
  type PgTableWithColumns,
  getTableConfig,
} from "drizzle-orm/pg-core";
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
   * Remove spillover and buffer entries.
   */
  rollback: () => void;
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
type Cache = Map<Table, Map<CacheKey, Row | null>>;
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
      await qb.$client.query(`COPY ${target} FROM '/dev/blob'`, [], {
        blob: new Blob([text]),
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
      );
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
}: {
  common: Common;
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

  const cache: Cache = new Map();
  const insertBuffer: Buffer = new Map();
  const updateBuffer: Buffer = new Map();
  /** Metadata about which entries in cache were not prefetched but were accessed anyway. */
  const spillover: Map<Table, Set<string>> = new Map();
  /** Profiling data about access patterns for each event. */
  const profile: Profile = new Map();

  const tables = Object.values(schema).filter(
    (table): table is PgTableWithColumns<TableConfig> => is(table, PgTable),
  );

  for (const table of tables) {
    cache.set(table, new Map());
    spillover.set(table, new Set());
    insertBuffer.set(table, new Map());
    updateBuffer.set(table, new Map());

    primaryKeyCache.set(table, []);
    for (const { js } of getPrimaryKeyColumns(table)) {
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

      const ck = getCacheKey(table, key, primaryKeyCache);
      // Note: order is important, it is an invariant that update entries
      // are prioritized over insert entries
      const bufferEntry =
        updateBuffer.get(table)!.get(ck) ?? insertBuffer.get(table)!.get(ck);

      if (bufferEntry) {
        common.metrics.ponder_indexing_cache_requests_total.inc({
          table: getTableName(table),
          type: isCacheComplete ? "complete" : "hit",
        });
        return structuredClone(bufferEntry.row);
      }

      const entry = cache.get(table)!.get(ck);

      if (entry !== undefined) {
        common.metrics.ponder_indexing_cache_requests_total.inc({
          table: getTableName(table),
          type: isCacheComplete ? "complete" : "hit",
        });
        return structuredClone(entry);
      }

      if (isCacheComplete) {
        common.metrics.ponder_indexing_cache_requests_total.inc({
          table: getTableName(table),
          type: "complete",
        });
        return null;
      }

      spillover.get(table)!.add(ck);

      common.metrics.ponder_indexing_cache_requests_total.inc({
        table: getTableName(table),
        type: "miss",
      });

      const endClock = startClock();

      const result = await qb
        .select()
        .from(table)
        .where(getWhereCondition(table, key))
        .then((res) => (res.length === 0 ? null : res[0]!))
        .then((row) => {
          cache.get(table)!.set(ck, structuredClone(row));

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
        .delete(table)
        .where(getWhereCondition(table, key))
        .returning()
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

          await qb.execute(sql.raw("SAVEPOINT flush"));

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
                await qb.execute(sql.raw("ROLLBACK to flush"));
                const text = getCopyText(
                  table,
                  values.map(({ row }) => row),
                );
                await copy(table, text);
                await qb.execute(sql.raw("SAVEPOINT flush"));
              },
            );

            if (result.status === "error") {
              error = new FlushError(result.error.message);
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
              error = new FlushError(error.message);
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
            if (shouldRecordBytes && tableCache.has(key) === false) {
              cacheBytes += getBytes(entry.row);
            }
            tableCache.set(key, entry.row);
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

          await qb.execute(sql.raw(createTempTableQuery));
          await qb.execute(sql.raw("SAVEPOINT flush"));

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
                await qb.execute(sql.raw("ROLLBACK to flush"));
                const text = getCopyText(
                  table,
                  values.map(({ row }) => row),
                );
                await copy(table, text, false);
                await qb.execute(sql.raw("SAVEPOINT flush"));
              },
            );

            if (result.status === "error") {
              error = new FlushError(result.error.message);
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
              error = new FlushError(error.message);
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

          await qb.execute(sql.raw(updateQuery));

          common.metrics.ponder_indexing_cache_query_duration.observe(
            {
              table: getTableName(table),
              method: "flush",
            },
            endClock(),
          );

          for (const [key, entry] of updateBuffer.get(table)!) {
            if (shouldRecordBytes && tableCache.has(key) === false) {
              cacheBytes += getBytes(entry.row);
            }
            tableCache.set(key, entry.row);
          }
          updateBuffer.get(table)!.clear();

          common.logger.debug({
            service: "database",
            msg: `Updated ${updateValues.length} '${getTableName(table)}' rows`,
          });

          await new Promise(setImmediate);
        }

        if (insertValues.length > 0 || updateValues.length > 0) {
          await qb.execute(sql.raw("RELEASE flush"));
        }
      }
    },
    async prefetch({ events }) {
      if (isCacheComplete) {
        if (cacheBytes < common.options.indexingCacheMaxBytes) {
          return;
        }

        isCacheComplete = false;
        for (const table of cache.keys()) {
          cache.get(table)!.clear();
          // Note: spillover is not cleared because it is an invariant
          // it is empty
        }
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

      for (const [table, tableCache] of cache) {
        for (const key of tableCache.keys()) {
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

      for (const [table] of spillover) {
        spillover.get(table)!.clear();
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
            const conditions = dedupe(
              Array.from(tablePredictions),
              ([key]) => key,
            ).map(([, prediction]) => getWhereCondition(table, prediction));

            if (conditions.length === 0) return;
            const endClock = startClock();

            await qb
              .select()
              .from(table)
              .where(or(...conditions))
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
                    tableCache.set(key, resultsPerKey.get(key)!);
                  } else {
                    tableCache.set(key, null);
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
    rollback() {
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
    },
    set qb(_qb: QB) {
      qb = _qb;
    },
  };
};
