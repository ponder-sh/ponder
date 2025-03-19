import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { getPrimaryKeyColumns } from "@/drizzle/index.js";
import { getColumnCasing } from "@/drizzle/kit/index.js";
import { addErrorMeta, toErrorMeta } from "@/indexing/index.js";
import type { Common } from "@/internal/common.js";
import { FlushError } from "@/internal/errors.js";
import type { Event, Schema, SchemaBuild } from "@/internal/types.js";
import type { Drizzle } from "@/types/db.js";
import { ZERO_CHECKPOINT_STRING } from "@/utils/checkpoint.js";
import { prettyPrint } from "@/utils/print.js";
import { startClock } from "@/utils/timer.js";
import { PGlite } from "@electric-sql/pglite";
import {
  type Column,
  type Table,
  type TableConfig,
  getTableColumns,
  getTableName,
  is,
} from "drizzle-orm";
import {
  PgTable,
  type PgTableWithColumns,
  getTableConfig,
} from "drizzle-orm/pg-core";
import type { PoolClient } from "pg";
import copy from "pg-copy-streams";
import { parseSqlError } from "./index.js";
import { getCacheKey, getWhereCondition, normalizeRow } from "./utils.js";

export type IndexingCache = {
  /**
   * Returns true if the cache has an entry for `table` with `key`.
   */
  has: (params: { table: Table; key: object }) => boolean;
  /**
   * Returns the entry for `table` with `key`.
   */
  get: (params: {
    table: Table;
    key: object;
    db: Drizzle<Schema>;
  }) =>
    | { [key: string]: unknown }
    | null
    | Promise<{ [key: string]: unknown } | null>;
  /**
   * Sets the entry for `table` with `key` to `row`.
   */
  set: (params: {
    table: Table;
    key: object;
    row: { [key: string]: unknown };
    isUpdate: boolean;
    metadata: {
      event: Event | undefined;
    };
  }) => { [key: string]: unknown };
  /**
   * Deletes the entry for `table` with `key`.
   */
  delete: (params: {
    table: Table;
    key: object;
    db: Drizzle<Schema>;
  }) => boolean | Promise<boolean>;
  /**
   * Writes all temporary data to the database.
   */
  flush: (params: { client: PoolClient | PGlite }) => Promise<void>;
  /**
   * Make all temporary data permanent and prepare the cache for
   * the next iteration.
   *
   * Note: It is assumed this is called after `flush`
   * because it clears the buffers.
   */
  commit: () => void;
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
};

type Cache = Map<
  Table,
  Map<
    string,
    {
      bytes: number;
      operationIndex: number;
      row: { [key: string]: unknown } | null;
    }
  >
>;

type Buffer = Map<
  Table,
  Map<
    string,
    {
      row: { [key: string]: unknown };
      metadata: {
        event: Event | undefined;
      };
    }
  >
>;

const getBytes = (value: unknown) => {
  // size of metadata
  let size = 13;

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

export const getCopyText = (
  table: Table,
  rows: { [key: string]: unknown }[],
) => {
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

export const getCopyHelper = ({ client }: { client: PoolClient | PGlite }) => {
  if (client instanceof PGlite) {
    return async (table: Table, text: string, includeSchema = true) => {
      const target = includeSchema
        ? `"${getTableConfig(table).schema ?? "public"}"."${getTableName(
            table,
          )}"`
        : `"${getTableName(table)}"`;
      await client.query(`COPY ${target} FROM '/dev/blob'`, [], {
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
        client.query(copy.from(`COPY ${target} FROM STDIN`)),
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
  checkpoint,
}: {
  common: Common;
  schemaBuild: Pick<SchemaBuild, "schema">;
  checkpoint: string;
}): IndexingCache => {
  const cache: Cache = new Map();
  const spillover: Cache = new Map();
  const insertBuffer: Buffer = new Map();
  const updateBuffer: Buffer = new Map();

  const primaryKeyCache = new Map<Table, [string, Column][]>();

  let isCacheComplete = checkpoint === ZERO_CHECKPOINT_STRING;

  let cacheBytes = 0;
  let spilloverBytes = 0;

  // LRU counter
  let totalCacheOps = 0;

  common.logger.debug({
    service: "indexing",
    msg: `Using a ${Math.round(
      common.options.indexingCacheMaxBytes / (1024 * 1024),
    )} MB indexing cache`,
  });

  for (const table of Object.values(schema).filter(
    (table): table is PgTableWithColumns<TableConfig> => is(table, PgTable),
  )) {
    cache.set(table, new Map());
    spillover.set(table, new Map());
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
        spillover.get(table)!.has(ck) ??
        insertBuffer.get(table)!.has(ck) ??
        updateBuffer.get(table)!.has(ck)
      );
    },
    async get({ table, key, db }) {
      const ck = getCacheKey(table, key, primaryKeyCache);
      // Note: order is important, it is an invariant that update entries
      // are prioritized over insert entries
      const bufferEntry =
        updateBuffer.get(table)!.get(ck) ?? insertBuffer.get(table)!.get(ck);

      if (bufferEntry) {
        common.metrics.ponder_indexing_cache_requests_total.inc({
          table: getTableName(table),
          type: "hit",
        });
        return structuredClone(bufferEntry.row);
      }

      const entry = spillover.get(table)!.get(ck) ?? cache.get(table)!.get(ck);

      if (entry) {
        entry.operationIndex = totalCacheOps++;

        if (entry.row) {
          common.metrics.ponder_indexing_cache_requests_total.inc({
            table: getTableName(table),
            type: "hit",
          });
          return structuredClone(entry.row);
        }
      }

      if (isCacheComplete) {
        common.metrics.ponder_indexing_cache_requests_total.inc({
          table: getTableName(table),
          type: "hit",
        });
        return null;
      }

      common.metrics.ponder_indexing_cache_requests_total.inc({
        table: getTableName(table),
        type: "miss",
      });

      const endClock = startClock();

      const result = await db
        .select()
        .from(table)
        .where(getWhereCondition(table, key))
        .then((res) => (res.length === 0 ? null : res[0]!))
        .then((row) => {
          const bytes = getBytes(row);
          spilloverBytes += bytes;

          spillover.get(table)!.set(ck, {
            bytes,
            operationIndex: totalCacheOps++,
            row: structuredClone(row),
          });
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
    set({ table, key, row: _row, isUpdate, metadata }) {
      const row = normalizeRow(table, _row, isUpdate);
      const ck = getCacheKey(table, key, primaryKeyCache);

      if (isUpdate) {
        updateBuffer.get(table)!.set(ck, {
          row: structuredClone(row),
          metadata,
        });
      } else {
        insertBuffer.get(table)!.set(ck, {
          row: structuredClone(row),
          metadata,
        });
      }

      return row;
    },
    async delete({ table, key, db }) {
      const ck = getCacheKey(table, key);

      const inInsertBuffer = insertBuffer.get(table)!.delete(ck);
      const inUpdateBuffer = updateBuffer.get(table)!.delete(ck);

      cache.get(table)!.delete(ck);
      spillover.get(table)!.delete(ck);

      const inDb = await db
        .delete(table)
        .where(getWhereCondition(table, key))
        .returning()
        .then((result) => result.length > 0);

      return inInsertBuffer || inUpdateBuffer || inDb;
    },
    async flush({ client }) {
      const copy = getCopyHelper({ client });

      for (const table of cache.keys()) {
        const tableSpillover = spillover.get(table)!;

        const insertValues = Array.from(insertBuffer.get(table)!.values());
        const updateValues = Array.from(updateBuffer.get(table)!.values());

        if (insertValues.length > 0) {
          const text = getCopyText(
            table,
            insertValues.map(({ row }) => row),
          );

          const endClock = startClock();

          // @ts-ignore
          await client.query("SAVEPOINT flush");
          await copy(table, text)
            .catch(async (error) => {
              const result = await recoverBatchError(
                insertValues,
                async (values) => {
                  // @ts-ignore
                  await client.query("ROLLBACK to flush");
                  const text = getCopyText(
                    table,
                    values.map(({ row }) => row),
                  );
                  await copy(table, text);
                  // @ts-ignore
                  await client.query("SAVEPOINT flush");
                },
              );

              if (result.status === "success") {
                return;
              }

              // Note: rollback so that the connection is available for other queries
              // @ts-ignore
              await client.query("ROLLBACK to flush");

              error = parseSqlError(result.error);
              error.stack = undefined;

              if (result.value.metadata.event) {
                addErrorMeta(
                  error,
                  `db.insert arguments:\n${prettyPrint(result.value.row)}`,
                );
                addErrorMeta(error, toErrorMeta(result.value.metadata.event));
                common.logger.error({
                  service: "indexing",
                  msg: `Error while processing ${getTableName(
                    table,
                  )}.insert() in event '${result.value.metadata.event.name}'`,
                  error,
                });
              }
              throw new FlushError(error.message);
            })
            .finally(() => {
              common.metrics.ponder_indexing_cache_query_duration.observe(
                {
                  table: getTableName(table),
                  method: "flush",
                },
                endClock(),
              );
            });

          for (const [key, entry] of insertBuffer.get(table)!) {
            const bytes = getBytes(entry.row);
            cacheBytes += bytes;
            totalCacheOps++;
            tableSpillover.set(key, {
              bytes,
              operationIndex: 0,
              row: entry.row,
            });
          }
          insertBuffer.get(table)!.clear();

          common.logger.debug({
            service: "database",
            msg: `Inserted ${insertValues.length} '${getTableName(
              table,
            )}' rows`,
          });
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
              UPDATE "${
                getTableConfig(table).schema ?? "public"
              }"."${getTableName(table)}" as target
              SET ${set}
              FROM "${getTableName(table)}" as source
              WHERE ${primaryKeys
                .map(({ sql }) => `target."${sql}" = source."${sql}"`)
                .join(" AND ")};
            `;
          const truncateQuery = `TRUNCATE TABLE "${getTableName(table)}" CASCADE`;

          const text = getCopyText(
            table,
            updateValues.map(({ row }) => row),
          );

          const endClock = startClock();

          try {
            // @ts-ignore
            await client.query(createTempTableQuery);
            // @ts-ignore
            await client.query("SAVEPOINT flush");
            await copy(table, text, false).catch(async (error) => {
              const result = await recoverBatchError(
                updateValues,
                async (values) => {
                  // @ts-ignore
                  await client.query("ROLLBACK to flush");
                  const text = getCopyText(
                    table,
                    values.map(({ row }) => row),
                  );
                  await copy(table, text, false);
                  // @ts-ignore
                  await client.query("SAVEPOINT flush");
                },
              );

              if (result.status === "success") {
                return;
              }

              // Note: rollback so that the connection is available for other queries
              // @ts-ignore
              await client.query("ROLLBACK to flush");

              error = parseSqlError(result.error);
              error.stack = undefined;

              addErrorMeta(
                error,
                `db.update arguments:\n${prettyPrint(result.value.row)}`,
              );

              throw error;
            });
            // @ts-ignore
            await client.query(updateQuery);
            // @ts-ignore
            await client.query(truncateQuery);
          } finally {
            common.metrics.ponder_indexing_cache_query_duration.observe(
              {
                table: getTableName(table),
                method: "flush",
              },
              endClock(),
            );
          }
          for (const [key, entry] of updateBuffer.get(table)!) {
            const bytes = getBytes(entry.row);
            cacheBytes += bytes;
            tableSpillover.set(key, {
              bytes,
              operationIndex: totalCacheOps++,
              row: entry.row,
            });
          }
          updateBuffer.get(table)!.clear();

          common.logger.debug({
            service: "database",
            msg: `Updated ${updateValues.length} '${getTableName(table)}' rows`,
          });
        }

        if (insertValues.length > 0 || updateValues.length > 0) {
          // @ts-ignore
          await client.query("RELEASE flush");
        }
      }
    },
    commit() {
      for (const [table, tableSpillover] of spillover) {
        const tableCache = cache.get(table)!;
        for (const [key, entry] of tableSpillover) {
          tableCache.set(key, entry);
        }
        tableSpillover.clear();
      }

      cacheBytes += spilloverBytes;
      spilloverBytes = 0;

      let cacheSize = 0;
      for (const { size } of cache.values()) cacheSize += size;

      const flushIndex =
        totalCacheOps -
        cacheSize * (1 - common.options.indexingCacheEvictRatio);

      if (cacheBytes + spilloverBytes > common.options.indexingCacheMaxBytes) {
        isCacheComplete = false;

        let rowCount = 0;

        for (const tableCache of cache.values()) {
          for (const [key, entry] of tableCache) {
            if (entry.operationIndex <= flushIndex) {
              tableCache.delete(key);
              cacheBytes -= entry.bytes;
              rowCount += 1;
            }
          }
        }

        common.logger.debug({
          service: "indexing",
          msg: `Evicted ${rowCount} rows from the cache`,
        });
      }
    },
    invalidate() {
      isCacheComplete = false;
    },
    rollback() {
      for (const tableSpillover of spillover.values()) {
        tableSpillover.clear();
      }

      for (const tableBuffer of insertBuffer.values()) {
        tableBuffer.clear();
      }

      for (const tableBuffer of updateBuffer.values()) {
        tableBuffer.clear();
      }

      spilloverBytes = 0;
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

      cacheBytes = 0;
      spilloverBytes = 0;
    },
  };
};
