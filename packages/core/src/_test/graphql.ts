import { drizzle } from "drizzle-orm/pg-proxy";
import type { DbClient } from "../database/db.js";
import type { Schema } from "../internal/types.js";

/**
 * A database client for GraphQL tests that doesn't connect to a database.
 *
 * Every SQL statement is recorded in `queries`. `rows` returns the canned
 * result rows for a statement, as objects whose keys are in column order.
 */
export const createTestDb = (
  schema: Schema,
  rows: (
    sql: string,
    params: unknown[],
  ) => Record<string, unknown>[] = () => [],
) => {
  const queries: { sql: string; params: unknown[] }[] = [];

  const raw = drizzle(
    async (sql, params, method) => {
      queries.push({ sql, params });
      const result = rows(sql, params);
      // Note: `db.execute()` resolves to the node-postgres result object.
      return {
        rows:
          method === "all"
            ? result.map(Object.values)
            : ({ rows: result } as unknown as unknown[]),
      };
    },
    { casing: "snake_case", schema },
  );
  // Note: GraphQL queries use `drizzle` directly, not `query`, which retries.
  const db = { dialect: "postgres", drizzle: raw } as unknown as DbClient;

  return { db, queries };
};
