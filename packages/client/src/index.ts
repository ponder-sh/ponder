import { type QueryWithTypings, type SQLWrapper, sql } from "drizzle-orm";
import { type PgDialect, type PgSession, pgTable } from "drizzle-orm/pg-core";
import { type PgRemoteDatabase, drizzle } from "drizzle-orm/pg-proxy";

const getEventSource = async () => {
  let SSE: typeof EventSource;
  if (typeof window === "undefined") {
    const undici = await import(/* webpackIgnore: true */ "undici");
    // @ts-ignore
    SSE = undici.EventSource;
  } else {
    SSE = EventSource;
  }

  return SSE;
};

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
  /** Query the database. */
  db: ClientDb<schema>;
  /** Subscribe to live updates. */
  live: <result>(
    queryFn: (db: ClientDb<schema>) => Promise<result>,
    onData: (result: result) => void,
    onError?: (error: Error) => void,
  ) => {
    unsubscribe: () => void;
  };
};

const getUrl = (
  baseUrl: string,
  method: "live" | "db" | "status",
  query?: QueryWithTypings,
) => {
  const url = new URL(`${baseUrl}/client/${method}`);
  if (query) {
    url.searchParams.set("sql", JSON.stringify(query));
  }
  return url;
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

const noopDatabase = drizzle(() => Promise.resolve({ rows: [] }), {
  casing: "snake_case",
});

// @ts-ignore
const dialect: PgDialect = noopDatabase.dialect;
// @ts-ignore
const session: PgSession = noopDatabase.session;

export const compileQuery = (query: SQLWrapper | string) => {
  const sequel = typeof query === "string" ? sql.raw(query) : query.getSQL();
  return dialect.sqlToQuery(sequel);
};

/**
 * Create a client for querying Ponder apps.
 *
 * @param baseUrl - The URL of the Ponder app.
 * @param schema - The schema of the Ponder app.
 *
 * @example
 * ```ts
 * import { createClient } from "@ponder/client";
 * import * as schema from "../ponder.schema";
 *
 * const client = createClient("https://...", { schema });
 * ```
 */
export const createClient = <schema extends Schema>(
  baseUrl: string,
  { schema }: { schema: schema },
): Client<schema> => {
  let sse: EventSource | undefined;
  let liveCount = 0;

  const client: Client<schema> = {
    db: drizzle(
      async (sql, params, _, typings) => {
        const builtQuery = { sql, params, typings };
        const response = await fetch(getUrl(baseUrl, "db", builtQuery), {
          method: "POST",
        });

        if (response.ok === false) {
          const error = new Error(await response.text());
          error.stack = undefined;
          throw error;
        }

        const result = await response.json();

        return {
          ...result,
          rows: result.rows.map((row: object) => Object.values(row)),
        };
      },
      { schema, casing: "snake_case" },
    ),
    live: (queryFn, onData, onError) => {
      // https://github.com/drizzle-team/drizzle-orm/blob/04c91434c7ac10aeb2923efd1d19a7ebf10ea9d4/drizzle-orm/src/pg-core/db.ts#L602-L621

      // @ts-ignore
      const builtQuery = compileQuery(queryFn(noopDatabase));

      if (
        builtQuery.sql ===
          'select "chain_id", "block_number", "block_timestamp", "ready" from "_ponder_status"' &&
        builtQuery.params.length === 0
      ) {
        const addEventListeners = () => {
          sse!.addEventListener("message", (event) => {
            const data = JSON.parse(event.data) as
              | { status: "success"; result: unknown }
              | { status: "error"; error: string };

            if (data.status === "error") {
              const error = new Error(data.error);
              error.stack = undefined;
              onError?.(error);
            } else {
              // @ts-ignore
              onData(data.result);
            }
          });

          sse!.addEventListener("error", () => {
            onError?.(new Error("server disconnected"));
          });
        };

        liveCount++;
        if (sse === undefined) {
          getEventSource().then((SSE) => {
            sse = new SSE(getUrl(baseUrl, "live"));
            addEventListeners();
          });
        } else {
          addEventListeners();
        }

        return {
          unsubscribe: () => {
            if (--liveCount === 0) sse?.close();
          },
        };
      } else {
        return client.live(
          (db) => db.select().from(status),
          () => {
            queryFn(client.db).then(onData).catch(onError);
          },
          onError,
        );
      }
    },
  };

  return client;
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
