import type { QB } from "@/database/queryBuilder.js";
import type { Common } from "@/internal/common.js";
import { RecordNotFoundError } from "@/internal/errors.js";
import type { SchemaBuild } from "@/internal/types.js";
import { prettyPrint } from "@/utils/print.js";
import { startClock } from "@/utils/timer.js";
import { type QueryWithTypings, type Table, getTableName } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";
import {
  type IndexingStore,
  checkOnchainTable,
  validateUpdateSet,
} from "./index.js";
import { getCacheKey, getWhereCondition } from "./utils.js";

export const createRealtimeIndexingStore = ({
  common,
  schemaBuild: { schema },
}: {
  common: Common;
  schemaBuild: Pick<SchemaBuild, "schema">;
}): IndexingStore => {
  let qb: QB = undefined!;
  const find = (table: Table, key: object) => {
    return qb.wrap((db) =>
      db
        .select()
        .from(table)
        .where(getWhereCondition(table, key))
        .then((res) => (res.length === 0 ? null : res[0]!)),
    );
  };

  return {
    // @ts-ignore
    find: async (table: Table, key) => {
      common.metrics.ponder_indexing_store_queries_total.inc({
        table: getTableName(table),
        method: "find",
      });
      checkOnchainTable(table, "find");
      return find(table, key);
    },
    // @ts-ignore
    insert(table: Table) {
      return {
        values: (values: any) => {
          // @ts-ignore
          const inner = {
            onConflictDoNothing: async () => {
              common.metrics.ponder_indexing_store_queries_total.inc({
                table: getTableName(table),
                method: "insert",
              });
              checkOnchainTable(table, "insert");

              const parseResult = (result: { [x: string]: any }[]) => {
                if (Array.isArray(values) === false) {
                  return result.length === 1 ? result[0] : null;
                }

                if (result.length === 0) {
                  return new Array(values.length).fill(null);
                }

                const rows = [];
                let resultIndex = 0;

                for (let i = 0; i < values.length; i++) {
                  if (
                    getCacheKey(table, values[i]) ===
                    getCacheKey(table, result[resultIndex]!)
                  ) {
                    rows.push(result[resultIndex++]!);
                  } else {
                    rows.push(null);
                  }
                }

                return rows;
              };

              return qb.wrap((db) =>
                db
                  .insert(table)
                  .values(values)
                  .onConflictDoNothing()
                  .returning()
                  .then(parseResult),
              );
            },
            onConflictDoUpdate: async (valuesU: any) => {
              common.metrics.ponder_indexing_store_queries_total.inc({
                table: getTableName(table),
                method: "insert",
              });
              checkOnchainTable(table, "insert");

              if (Array.isArray(values)) {
                const rows = [];
                for (const value of values) {
                  const row = await find(table, value);

                  if (row) {
                    const set =
                      typeof valuesU === "function"
                        ? validateUpdateSet(table, valuesU(row), row)
                        : validateUpdateSet(table, valuesU, row);

                    rows.push(
                      await qb.wrap((db) =>
                        db
                          .update(table)
                          .set(set)
                          .where(getWhereCondition(table, value))
                          .returning()
                          .then((res) => res[0]),
                      ),
                    );
                  } else {
                    rows.push(
                      await qb.wrap((db) =>
                        db
                          .insert(table)
                          .values(value)
                          .returning()
                          .then((res) => res[0]),
                      ),
                    );
                  }
                }
                return rows;
              } else {
                const row = await find(table, values);

                if (row) {
                  const set =
                    typeof valuesU === "function"
                      ? validateUpdateSet(table, valuesU(row), row)
                      : validateUpdateSet(table, valuesU, row);

                  return qb.wrap((db) =>
                    db
                      .update(table)
                      .set(set)
                      .where(getWhereCondition(table, values))
                      .returning()
                      .then((res) => res[0]),
                  );
                } else {
                  return qb.wrap((db) =>
                    db
                      .insert(table)
                      .values(values)
                      .returning()
                      .then((res) => res[0]),
                  );
                }
              }
            },
            // biome-ignore lint/suspicious/noThenProperty: <explanation>
            then: (onFulfilled, onRejected) =>
              (async () => {
                common.metrics.ponder_indexing_store_queries_total.inc({
                  table: getTableName(table),
                  method: "insert",
                });
                checkOnchainTable(table, "insert");

                return qb.wrap((db) =>
                  db
                    .insert(table)
                    .values(values)
                    .returning()
                    .then((res) => (Array.isArray(values) ? res : res[0])),
                );
              })().then(onFulfilled, onRejected),
            catch: (onRejected) => inner.then(undefined, onRejected),
            finally: (onFinally) =>
              inner.then(
                (value: any) => {
                  onFinally?.();
                  return value;
                },
                (reason: any) => {
                  onFinally?.();
                  throw reason;
                },
              ),
            // @ts-ignore
          } satisfies ReturnType<ReturnType<IndexingStore["insert"]>["values"]>;

          return inner;
        },
      };
    },
    // @ts-ignore
    update(table: Table, key) {
      return {
        set: async (values: any) => {
          common.metrics.ponder_indexing_store_queries_total.inc({
            table: getTableName(table),
            method: "update",
          });
          checkOnchainTable(table, "update");

          const row = await find(table, key);
          if (typeof values === "function") {
            if (row === null) {
              const error = new RecordNotFoundError(
                `No existing record found in table '${getTableName(table)}'`,
              );
              error.meta.push(`db.update arguments:\n${prettyPrint(key)}`);
              throw error;
            }

            const set = validateUpdateSet(table, values(row), row);
            return qb.wrap((db) =>
              db
                .update(table)
                .set(set)
                .where(getWhereCondition(table, key))
                .returning()
                .then((res) => res[0]),
            );
          } else {
            const set = validateUpdateSet(table, values, row!);
            return qb.wrap((db) =>
              db
                .update(table)
                .set(set)
                .where(getWhereCondition(table, key))
                .returning()
                .then((res) => res[0]),
            );
          }
        },
      };
    },
    // @ts-ignore
    delete: async (table: Table, key) => {
      common.metrics.ponder_indexing_store_queries_total.inc({
        table: getTableName(table),
        method: "delete",
      });
      checkOnchainTable(table, "delete");

      const deleted = await qb.wrap((db) =>
        db.delete(table).where(getWhereCondition(table, key)).returning(),
      );

      return deleted.length > 0;
    },
    // @ts-ignore
    sql: drizzle(
      async (_sql, params, method, typings) => {
        const query: QueryWithTypings = { sql: _sql, params, typings };

        const endClock = startClock();

        try {
          const result = await qb.wrap((db) =>
            db._.session
              .prepareQuery(query, undefined, undefined, method === "all")
              .execute(),
          );

          // @ts-ignore
          return { rows: result.rows.map((row) => Object.values(row)) };
        } finally {
          common.metrics.ponder_indexing_store_raw_sql_duration.observe(
            endClock(),
          );
        }
      },
      { schema, casing: "snake_case" },
    ),
    set qb(_qb: QB) {
      qb = _qb;
    },
  };
};
