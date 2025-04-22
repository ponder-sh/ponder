import type { QueryWithTypings, SQLWrapper } from "drizzle-orm";
import type { PgDialect } from "drizzle-orm/pg-core";
import { type PgRemoteDatabase, drizzle } from "drizzle-orm/pg-proxy";
import { EventSource } from "eventsource";
import superjson from "superjson";

type Schema = { [name: string]: unknown };

type Prettify<T> = {
  [K in keyof T]: T[K];
} & {};

export type Status = {
  [chainName: string]: {
    chainId: number;
    block: { number: number; timestamp: number };
  };
};

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
  /**
   * Subscribe to live updates.
   *
   * @param queryFn - The query to subscribe to.
   * @param onData - The callback to call with each new query result
   * @param onError - The callback to call when an error occurs.
   *
   * @example
   * ```ts
   * import { createClient } from "@ponder/client";
   * import * as schema from "../ponder.schema";
   *
   * const client = createClient("https://.../sql", { schema });
   *
   * client.live(
   *   (db) => db.select().from(schema.account),
   *   (result) => console.log(result),
   *   (error) => console.error(error),
   * );
   * ```
   */
  live: <result>(
    queryFn: (db: ClientDb<schema>) => Promise<result>,
    onData: (result: result) => void,
    onError?: (error: Error) => void,
  ) => {
    unsubscribe: () => void;
  };
  /** Get the status of all chains. */
  getStatus: () => Promise<Status>;
};

const getUrl = (
  baseUrl: string,
  method: "live" | "db" | "status",
  query?: QueryWithTypings,
) => {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname}/${method}`;
  if (query) {
    url.searchParams.set("sql", superjson.stringify(query));
  }
  return url;
};

const noopDatabase = drizzle(() => Promise.resolve({ rows: [] }), {
  casing: "snake_case",
});

// @ts-ignore
const dialect: PgDialect = noopDatabase.dialect;

export const compileQuery = (query: SQLWrapper) => {
  return dialect.sqlToQuery(query.getSQL());
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
 * const client = createClient("https://.../sql", { schema });
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
      if (sse === undefined) {
        sse = new EventSource(getUrl(baseUrl, "live"));
      }

      const onDataListener = (_event: MessageEvent) => {
        queryFn(client.db).then(onData).catch(onError);
      };

      const onErrorListener = (_event: MessageEvent) => {
        onError?.(new Error("server disconnected"));
      };

      sse?.addEventListener("message", onDataListener);
      sse?.addEventListener("error", onErrorListener);
      liveCount = liveCount + 1;

      return {
        unsubscribe: () => {
          sse?.removeEventListener("message", onDataListener);
          sse?.removeEventListener("error", onErrorListener);
          liveCount = liveCount - 1;
          if (liveCount === 0) {
            sse?.close();
            sse = undefined;
          }
        },
      };
    },
    getStatus: async () => {
      const response = await fetch(getUrl(baseUrl, "status"), {
        method: "POST",
      });

      return response.json();
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
  notLike,
  ilike,
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
