import {
  eq,
  getTableColumns,
  getTableName,
  isTable,
  or,
  sql,
  type Table,
} from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { Effect, Result } from "effect";
import {
  builder,
  chunkRows,
  copyFrom,
  type DbRunner,
  rawSql,
  type Statement,
} from "../database/db.js";
import { getPrimaryKeyColumns } from "../drizzle/index.js";
import { getColumnCasing } from "../drizzle/kit/index.js";
import { getPartitionName } from "../drizzle/onchain.js";
import { addErrorMeta, toErrorMeta } from "../indexing/index.js";
import { DelayedInsertError } from "../internal/errors.js";
import { Metrics } from "../internal/metrics.js";
import { Options } from "../internal/options.js";
import type {
  CrashRecoveryCheckpoint,
  Event,
  SchemaBuild,
} from "../internal/types.js";
import { dedupe } from "../utils/dedupe.js";
import { prettyPrint } from "../utils/print.js";
import { startClockEffect } from "../utils/timer.js";
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
   * Returns the entry for `table` with `key`.
   *
   * @dev Returns the entry when it is cached, and an Effect that reads it from
   * the database otherwise, so that cache hits don't run a fiber.
   */
  get: (params: {
    table: Table;
    key: object;
  }) => Row | null | Effect.Effect<Row | null, Error>;
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
  delete: (params: {
    table: Table;
    key: object;
  }) => Effect.Effect<boolean, Error>;
  /**
   * Writes all temporary data to the database.
   *
   * @param params.tableNames - If provided, only flush the tables in the set.
   */
  flush: (params?: { tableNames?: Set<string> }) => Effect.Effect<void, Error>;
  /**
   * Predict and load rows that will be accessed in the next event batch.
   */
  prefetch: (params: { events: Event[] }) => Effect.Effect<void, Error>;
  /**
   * Marks the cache as incomplete.
   */
  invalidate: () => void;
  /**
   * Deletes all entries from the cache.
   */
  clear: () => void;
  event: Event | undefined;
  /** Client for reads and writes, such as the transaction of the current batch. */
  client: DbRunner;
};

const SAMPLING_RATE = 10;
/** A table is reloaded if its rows are at most this fraction of the cache budget. */
const RELOAD_FRACTION = 4;
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
        type: "delimiter";
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
    /** `true` if the table was read, with `get` or `delete`. */
    isRead: boolean;
    /**
     * Estimated size in bytes of the rows that were inserted while the table
     * was complete and never read. These rows are not cached, so that tables
     * that are only written (e.g. one row per event) don't hold every row in
     * memory.
     */
    unreadBytes: number;
    /** `true` if the next `prefetch` reads the whole table (see `markRead`). */
    isReloadPending: boolean;
  }
>;
/**
 * Buffer of database rows that will be flushed to the database.
 */
type Buffer = Map<Table, Map<CacheKey, BufferEntry>>;
type BufferEntry = {
  row: Row;
  metadata: { event: Event | undefined };
};
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
            } else if (Buffer.isBuffer(value)) {
              result += `\\\\x${value.toString("hex")}`;
            } else {
              result += String(value).replace(ESCAPE_REGEX, "\\$1");
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
          } else if (Buffer.isBuffer(value)) {
            result += `\\\\x${value.toString("hex")}\t`;
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

/** Returns the quoted name of the table (or partition) to copy rows into. */
const getCopyTarget = (
  table: Table,
  chainId: number | undefined,
  includeSchema = true,
) => {
  const name =
    chainId === undefined
      ? getTableName(table)
      : getPartitionName(table, chainId);
  return includeSchema
    ? `"${getTableConfig(table).schema ?? "public"}"."${name}"`
    : `"${name}"`;
};

/**
 * Run `callback` with `values`. On failure, bisect `values` to find the first
 * value that fails.
 */
export const recoverBatchError = <T, E, R>(
  values: T[],
  callback: (values: T[]) => Effect.Effect<unknown, E, R>,
): Effect.Effect<
  { status: "success" } | { status: "error"; error: E; value: T },
  never,
  R
> =>
  Effect.gen(function* () {
    const result = yield* Effect.result(callback(values));
    if (Result.isSuccess(result)) return { status: "success" } as const;

    if (values.length === 1) {
      return {
        status: "error",
        error: result.failure,
        value: values[0]!,
      } as const;
    }
    const left = values.slice(0, Math.floor(values.length / 2));
    const right = values.slice(Math.floor(values.length / 2));
    const resultLeft = yield* recoverBatchError(left, callback);
    if (resultLeft.status === "error") {
      return resultLeft;
    }
    return yield* recoverBatchError(right, callback);
  });

export const createIndexingCache = ({
  schemaBuild: { schema },
  crashRecoveryCheckpoint,
  eventCount,
  chainId,
}: {
  schemaBuild: Pick<SchemaBuild, "schema">;
  crashRecoveryCheckpoint: CrashRecoveryCheckpoint;
  eventCount: { [eventName: string]: number };
  chainId?: number;
}): Effect.Effect<IndexingCache, never, Options | Metrics> =>
  Effect.gen(function* () {
    const options = yield* Options;
    const metrics = yield* Metrics;

    let event: Event | undefined;
    let client: DbRunner = undefined!;

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
        isRead: false,
        unreadBytes: 0,
        isReloadPending: false,
      });
      insertBuffer.set(table, new Map());
      updateBuffer.set(table, new Map());
    }

    const getTarget = (table: Table) =>
      chainId === undefined
        ? getTableName(table)
        : getPartitionName(table, chainId);

    /** Statements that insert `entries` into the table. Throws when a row can't be serialized. */
    const insertStatements = (
      table: Table,
      entries: BufferEntry[],
    ): Statement[] => {
      if (entries.length === 0) return [];
      const rows = entries.map(({ row }) => row);
      if (entries.length > LOW_BATCH_THRESHOLD) {
        return [
          copyFrom(getCopyTarget(table, chainId), getCopyText(table, rows)),
        ];
      }
      return [builder.insert(table).values(rows)];
    };

    /**
     * Statements that update the rows of `entries`. A large batch is copied
     * into a temp table, which updates the table.
     */
    const updateStatements = (
      table: Table,
      entries: BufferEntry[],
    ): Statement[] => {
      if (entries.length === 0) return [];
      const rows = entries.map(({ row }) => row);
      const primaryKeys = getPrimaryKeyColumns(table);

      if (entries.length > LOW_BATCH_THRESHOLD) {
        const target = getTarget(table);
        const schema = getTableConfig(table).schema ?? "public";
        const columns = Object.values(getTableColumns(table)).map(
          (column) => `"${getColumnCasing(column, "snake_case")}"`,
        );

        return [
          rawSql(
            `CREATE TEMP TABLE IF NOT EXISTS "${target}" AS SELECT * FROM "${schema}"."${target}" WITH NO DATA`,
          ),
          copyFrom(
            getCopyTarget(table, chainId, false),
            getCopyText(table, rows),
          ),
          rawSql(`
UPDATE "${schema}"."${target}" as target
SET ${columns.map((column) => `${column} = source.${column}`).join(",\n")}
FROM "${target}" source
WHERE ${primaryKeys.map(({ sql }) => `target."${sql}" = source."${sql}"`).join(" AND ")}`),
          rawSql(`TRUNCATE TABLE "${target}"`),
        ];
      }

      return [
        builder
          .insert(table)
          .values(rows)
          .onConflictDoUpdate({
            // @ts-expect-error
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
      ];
    };

    /**
     * Find the row that failed the flush, and fail with it.
     *
     * @dev The rows of each table are written again in bisected batches, each
     * in a savepoint, to find the exact row that caused the error.
     */
    const recoverFlushError = (flushed: Table[], flushError: Error) =>
      Effect.gen(function* () {
        const endClock = yield* startClockEffect;

        for (const table of flushed) {
          for (const [type, buffer, build] of [
            ["insert", insertBuffer, insertStatements],
            ["update", updateBuffer, updateStatements],
          ] as const) {
            const values = Array.from(buffer.get(table)!.values());
            if (values.length === 0) continue;

            const result = yield* recoverBatchError(values, (values) =>
              Effect.try({
                try: () => build(table, values),
                catch: (error) => error as Error,
              }).pipe(
                Effect.flatMap((statements) =>
                  client.run(statements, { savepoint: true }),
                ),
              ),
            );

            if (result.status === "error") {
              return yield* failDelayedInsert({
                type,
                table,
                row: result.value,
                cause: result.error,
                rowCount: values.length,
                duration: yield* endClock,
              });
            }
          }
        }

        // Note: if we weren't able to find the exact row that caused the error,
        // fail with the original error.
        return yield* Effect.fail(flushError);
      });

    /**
     * Mark `table` as read. If rows were inserted before without being cached,
     * the table is incomplete, and it is reloaded by the next `prefetch` if it
     * is small.
     */
    const markRead = (table: Table) => {
      const tableCache = cache.get(table)!;
      if (tableCache.isRead) return;
      tableCache.isRead = true;
      if (
        tableCache.isCacheComplete === false ||
        tableCache.unreadBytes === 0
      ) {
        return;
      }
      tableCache.isCacheComplete = false;
      tableCache.isReloadPending =
        tableCache.unreadBytes <=
        options.indexingCacheMaxBytes / RELOAD_FRACTION;
    };

    const indexingCache: IndexingCache = {
      get({ table, key }) {
        markRead(table);

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
          metrics.incrementIndexingCacheRequests(
            getTableName(table),
            cache.get(table)!.isCacheComplete ? "complete" : "hit",
          );
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

          metrics.incrementIndexingCacheRequests(
            getTableName(table),
            cache.get(table)!.isCacheComplete ? "complete" : "hit",
          );
          return entry;
        }

        cache.get(table)!.diskReads++;

        if (cache.get(table)!.isCacheComplete) {
          metrics.incrementIndexingCacheRequests(
            getTableName(table),
            "complete",
          );
          return null;
        }

        cache.get(table)!.spillover.add(ck);

        metrics.incrementIndexingCacheRequests(getTableName(table), "miss");

        return Effect.gen(function* () {
          const endClock = yield* startClockEffect;

          const rows = yield* client.run(
            builder.select().from(table).where(getWhereCondition(table, key)),
          );
          const row: Row | null = rows.length === 0 ? null : rows[0]!;

          // Note: the size is not recorded because it is not possible
          // to miss the cache when in the "full in-memory" mode
          cache.get(table)!.cache.set(ck, row);

          metrics.ponder_indexing_cache_query_duration.observe(
            { table: getTableName(table), method: "find" },
            yield* endClock,
          );
          return row;
        });
      },
      set({ table, key, row: _row, isUpdate }) {
        const row = isUpdate ? _row : normalizeRow(table, _row, false);
        const ck = getCacheKey(table, key, primaryKeyCache);

        if (isUpdate) {
          updateBuffer.get(table)!.set(ck, { row, metadata: { event } });
        } else {
          insertBuffer.get(table)!.set(ck, { row, metadata: { event } });
        }

        return row;
      },
      delete: ({ table, key }) =>
        Effect.gen(function* () {
          markRead(table);
          const ck = getCacheKey(table, key, primaryKeyCache);

          const inInsertBuffer = insertBuffer.get(table)!.delete(ck);
          const inUpdateBuffer = updateBuffer.get(table)!.delete(ck);

          cache.get(table)!.cache.delete(ck);

          const rows = yield* client.run(
            builder
              .delete(table)
              .where(getWhereCondition(table, key))
              .returning(),
          );

          return inInsertBuffer || inUpdateBuffer || rows.length > 0;
        }),
      flush: ({ tableNames } = {}) =>
        Effect.gen(function* () {
          const context = {
            logAnnotations: { action: "flush_database_rows" },
          };
          const flushEndClock = yield* startClockEffect;

          const flushed = tables.filter(
            (table) =>
              (tableNames === undefined ||
                tableNames.has(getTableName(table))) &&
              (insertBuffer.get(table)!.size > 0 ||
                updateBuffer.get(table)!.size > 0),
          );
          if (flushed.length === 0) return;

          const statements = yield* Effect.try({
            try: () =>
              flushed.flatMap((table) => [
                ...insertStatements(
                  table,
                  Array.from(insertBuffer.get(table)!.values()),
                ),
                ...updateStatements(
                  table,
                  Array.from(updateBuffer.get(table)!.values()),
                ),
              ]),
            catch: (error) => error as Error,
          }).pipe(Effect.tap(() => Effect.yieldNow));

          yield* client
            .run(statements, { savepoint: true, ...context })
            .pipe(Effect.catch((error) => recoverFlushError(flushed, error)));

          const duration = yield* flushEndClock;

          for (const table of flushed) {
            const tableCache = cache.get(table)!;
            const shouldRecordBytes = tableCache.isCacheComplete;
            const inserts = insertBuffer.get(table)!;
            const updates = updateBuffer.get(table)!;

            metrics.ponder_indexing_cache_query_duration.observe(
              { table: getTableName(table), method: "flush" },
              duration,
            );

            if (tableCache.isRead) {
              let bytes = 0;
              for (const [key, entry] of inserts) {
                if (shouldRecordBytes && tableCache.cache.has(key) === false) {
                  bytes += getBytes(entry.row) + getBytes(key);
                }
                tableCache.cache.set(key, entry.row);
              }
              tableCache.bytes += bytes;
            } else if (shouldRecordBytes && inserts.size > 0) {
              // Note: The size of the rows is estimated from one row.
              const [key, { row }] = inserts.entries().next().value!;
              tableCache.unreadBytes +=
                inserts.size * (getBytes(row) + getBytes(key));
            }

            let bytes = 0;
            for (const [key, entry] of updates) {
              if (shouldRecordBytes && tableCache.cache.has(key) === false) {
                bytes += getBytes(entry.row) + getBytes(key);
              }
              tableCache.cache.set(key, entry.row);
            }
            tableCache.bytes += bytes;

            yield* Effect.logDebug({
              msg: "Wrote database rows",
              table:
                chainId === undefined
                  ? getTableName(table)
                  : getPartitionName(table, chainId),
              row_count: inserts.size + updates.size,
              duration,
            });

            inserts.clear();
            updates.clear();
          }
        }),
      prefetch: ({ events }) =>
        Effect.gen(function* () {
          const context = {
            logAnnotations: { action: "prefetch_database_rows" },
          };

          // Note: The buffered rows were flushed before `prefetch`, so the
          // database has the newest rows.
          yield* Effect.forEach(
            tables.filter((table) => cache.get(table)!.isReloadPending),
            (table) =>
              Effect.gen(function* () {
                const endClock = yield* startClockEffect;

                // Note: With isolated ordering, the table has the rows of
                // every chain.
                const rows = yield* client.run(
                  chainId === undefined
                    ? builder.select().from(table)
                    : builder
                        .select()
                        .from(table)
                        .where(eq(getTableColumns(table).chainId!, chainId)),
                  context,
                );

                const tableCache = cache.get(table)!;
                tableCache.cache.clear();
                tableCache.spillover.clear();
                tableCache.prefetched.clear();
                tableCache.bytes = 0;
                for (const row of rows) {
                  const ck = getCacheKey(table, row, primaryKeyCache);
                  tableCache.cache.set(ck, row);
                  tableCache.bytes += getBytes(row) + getBytes(ck);
                }
                tableCache.isCacheComplete = true;
                tableCache.isReloadPending = false;

                yield* Effect.logDebug({
                  msg: "Reloaded database rows",
                  table: getTableName(table),
                  row_count: rows.length,
                  duration: yield* endClock,
                });
              }),
            { concurrency: "unbounded", discard: true },
          );

          let totalBytes = 0;
          for (const table of tables) {
            totalBytes += cache.get(table)!.bytes;
          }

          // If data from the cache needs to be evicted, start with the
          // table with the least disk reads.

          if (totalBytes > options.indexingCacheMaxBytes) {
            for (const table of tables.sort(
              (a, b) => cache.get(a)!.diskReads - cache.get(b)!.diskReads,
            )) {
              if (cache.get(table)!.isCacheComplete === false) continue;

              totalBytes -= cache.get(table)!.bytes;
              const rowCount = cache.get(table)!.cache.size;

              cache.get(table)!.bytes = 0;
              cache.get(table)!.cache.clear();
              cache.get(table)!.isCacheComplete = false;
              // Note: spillover is not cleared because it is an invariant
              // it is empty

              yield* Effect.logDebug({
                msg: "Evicted cached database rows",
                table: getTableName(table),
                row_count: rowCount,
              });

              if (totalBytes < options.indexingCacheMaxBytes) break;
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
                    (count * SAMPLING_RATE) /
                    eventCount[event.eventCallback.name]!;
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
            metrics.incrementIndexingCacheRequests(
              getTableName(table),
              "prefetch",
              tablePredictions.size,
            );
          }

          yield* Effect.forEach(
            Array.from(prediction.entries()).filter(
              ([, tablePredictions]) => tablePredictions.size > 0,
            ),
            ([table, tablePredictions]) =>
              Effect.gen(function* () {
                for (const [key] of tablePredictions) {
                  cache.get(table)!.prefetched.add(key);
                }

                const conditions = dedupe(
                  Array.from(tablePredictions),
                  ([key]) => key,
                ).map(([, prediction]) => getWhereCondition(table, prediction));

                if (conditions.length === 0) return;
                const endClock = yield* startClockEffect;

                const results = (yield* Effect.forEach(
                  chunkRows(conditions, getPrimaryKeyColumns(table).length),
                  (conditions) =>
                    client.run(
                      builder
                        .select()
                        .from(table)
                        .where(or(...conditions)),
                      context,
                    ),
                  { concurrency: "unbounded" },
                )).flat();

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

                yield* Effect.logDebug({
                  msg: "Pre-queried database rows",
                  table: getTableName(table),
                  row_count: results.length,
                  duration: yield* endClock,
                });

                metrics.ponder_indexing_cache_query_duration.observe(
                  { table: getTableName(table), method: "load" },
                  yield* endClock,
                );
              }),
            { concurrency: "unbounded", discard: true },
          );
        }),
      invalidate() {
        for (const tableCache of cache.values()) {
          tableCache.isCacheComplete = false;
          tableCache.isReloadPending = false;
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
      get event() {
        return event;
      },
      set event(_event: Event | undefined) {
        event = _event;
      },
      get client() {
        return client;
      },
      set client(_client: DbRunner) {
        client = _client;
      },
    };

    return indexingCache;
  });

/**
 * Log and fail with a {@link DelayedInsertError} for the row that failed to flush.
 */
const failDelayedInsert = ({
  type,
  table,
  row,
  cause,
  rowCount,
  duration,
}: {
  type: "insert" | "update";
  table: Table;
  row: BufferEntry;
  cause: Error;
  rowCount: number;
  duration: number;
}) =>
  Effect.gen(function* () {
    const error = new DelayedInsertError(cause.message);
    error.stack = undefined;

    addErrorMeta(
      error,
      `db.${type} arguments:\n${prettyPrint(row.row, { truncate: false })}`,
    );

    if (row.metadata.event) {
      addErrorMeta(error, toErrorMeta(row.metadata.event));
    }

    yield* Effect.logWarning({
      msg: "Failed to write cached database rows",
      ...(row.metadata.event
        ? { event: row.metadata.event.eventCallback.name }
        : {}),
      type,
      table: getTableName(table),
      row_count: rowCount,
      duration,
      error,
    });

    return yield* Effect.fail(error);
  });
