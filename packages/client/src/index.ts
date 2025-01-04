import { pgTable } from "drizzle-orm/pg-core";
import { type PgRemoteDatabase, drizzle } from "drizzle-orm/pg-proxy";

type Schema = { [name: string]: unknown };

type Prettify<T> = {
  [K in keyof T]: T[K];
} & {};

export type Client<schema extends Schema = Schema> = {
  db: Prettify<
    Omit<
      PgRemoteDatabase<schema>,
      | "insert"
      | "update"
      | "delete"
      | "transaction"
      | "refreshMaterializedView"
      | "_"
    >
  >;
};

/**
 * A table that tracks the status of each chain.
 *
 * @property {number} chainId - The chain ID.
 * @property {number} blockNumber - The closest-to-tip indexed block number.
 * @property {number} blockTimestamp - The closest-to-tip indexed block timestamp.
 * @property {boolean} ready - `true` if the chain has completed the historical backfill.
 */
export const status = pgTable("_ponder_status", (t) => ({
  chainId: t.bigint({ mode: "number" }).primaryKey(),
  blockNumber: t.bigint({ mode: "number" }),
  blockTimestamp: t.bigint({ mode: "number" }),
  ready: t.boolean().notNull(),
}));

// @ts-ignore
status[Symbol.for("ponder:onchain")] = true;

export const createClient = <schema extends Schema>(
  url: string,
  { schema }: { schema: schema },
): Client<schema> => {
  const db = drizzle(
    async (sql, params, method, typings) => {
      const result = await fetch(`${url}/client`, {
        method: "POST",
        body: JSON.stringify({ sql, params, method, typings }),
      });

      return await result.json();
    },
    { schema, casing: "snake_case" },
  );

  return { db };
};

export {
  sql,
  eq,
  gt,
  gte,
  lt,
  lte,
  ne,
  isNull,
  isNotNull,
  inArray,
  notInArray,
  exists,
  notExists,
  between,
  notBetween,
  like,
  notIlike,
  not,
  asc,
  desc,
  and,
  or,
  count,
  countDistinct,
  avg,
  avgDistinct,
  sum,
  sumDistinct,
  max,
  min,
  relations,
} from "drizzle-orm";

export {
  alias,
  union,
  unionAll,
  intersect,
  intersectAll,
  except,
  exceptAll,
} from "drizzle-orm/pg-core";

export { setDatabaseSchema } from "./setDatabaseSchema.js";
