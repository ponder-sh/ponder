import { type SQLWrapper, sql } from "drizzle-orm";
import { type PgDialect, type PgSession, pgTable } from "drizzle-orm/pg-core";
import { type PgRemoteDatabase, drizzle } from "drizzle-orm/pg-proxy";
import { EventSource } from "undici";

type Schema = { [name: string]: unknown };

type Prettify<T> = {
  [K in keyof T]: T[K];
} & {};

type ClientDb<schema extends Schema = Schema> = Prettify<
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

export type Client<schema extends Schema = Schema> = {
  db: ClientDb<schema>;
  live: <result>(
    query: (db: ClientDb<schema>) => Promise<result>,
    callback: (result: result) => void,
  ) => {
    unsubscribe: () => void;
  };
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
  const noopDatabase = drizzle(
    () => {
      return Promise.resolve({ rows: [] });
    },
    { schema, casing: "snake_case" },
  );

  // @ts-ignore
  const dialect: PgDialect = noopDatabase.dialect;

  // @ts-ignore
  const session: PgSession = noopDatabase.session;

  return {
    db: drizzle(
      async (sql, params, method, typings) => {
        const result = await fetch(`${url}/client/db`, {
          method: "POST",
          body: JSON.stringify({ sql, params, method, typings }),
        });

        return await result.json();
      },
      { schema, casing: "snake_case" },
    ),
    live: (_query, callback) => {
      // https://github.com/drizzle-team/drizzle-orm/blob/04c91434c7ac10aeb2923efd1d19a7ebf10ea9d4/drizzle-orm/src/pg-core/db.ts#L602-L621

      const query = _query(noopDatabase) as unknown as SQLWrapper | string;
      const sequel =
        typeof query === "string" ? sql.raw(query) : query.getSQL();
      const builtQuery = dialect.sqlToQuery(sequel);

      const prepared = session.prepareQuery(
        builtQuery,
        undefined,
        undefined,
        false,
      );

      const sse = new EventSource(
        `${url}/client/live?${new URLSearchParams({
          query: JSON.stringify(builtQuery),
        }).toString()}`,
      );

      sse.onmessage = (event) => {
        // @ts-ignore
        callback(prepared.mapResult(JSON.parse(event.data), true).rows);
      };

      sse.onerror = () => {
        sse.close();
      };

      return {
        unsubscribe: () => {
          sse.close();
        },
      };
    },
  };
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
