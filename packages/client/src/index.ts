import {
  type AnyColumn,
  Column,
  is,
  isTable,
  mapRelationalRow,
  type QueryWithTypings,
  type SelectedFieldsOrdered,
  SQL,
  type SQLWrapper,
  Table,
} from "drizzle-orm";
import { isPgEnum, type PgDialect } from "drizzle-orm/pg-core";
import { PgCountBuilder } from "drizzle-orm/pg-core/query-builders/count";
import { PgRelationalQuery } from "drizzle-orm/pg-core/query-builders/query";
import { PgRaw } from "drizzle-orm/pg-core/query-builders/raw";
import { drizzle, type PgRemoteDatabase } from "drizzle-orm/pg-proxy";
import { TypedQueryBuilder } from "drizzle-orm/query-builders/query-builder";
import { EventSource } from "eventsource";
import superjson from "superjson";

type Schema = { [name: string]: unknown };

type Prettify<T> = {
  [K in keyof T]: T[K];
} & {};

export type Status = {
  [chainName: string]: {
    id: number;
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
  method: "live" | "db",
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

// @ts-expect-error
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
  params: { schema?: schema } = {},
): Client<schema> => {
  const client: Client<schema> = {
    db: drizzle(
      async (sql, params, method, typings) => {
        const builtQuery = { sql, params, typings };
        const response = await fetch(getUrl(baseUrl, "db", builtQuery), {
          method: "GET",
        });

        if (response.ok === false) {
          const error = new Error(await response.text());
          error.stack = undefined;
          throw error;
        }

        const result = await response.json();

        if (method === "all") {
          return {
            ...result,
            rows: result.rows.map((row: object) => Object.values(row)),
          };
        }

        return result;
      },
      { schema: params.schema, casing: "snake_case" },
    ),
    live: (queryFn, onData, onError) => {
      const noopDatabase = drizzle(() => Promise.resolve({ rows: [] }), {
        schema: params.schema,
        casing: "snake_case",
      });

      const queryPromise = queryFn(noopDatabase);

      if ("getSQL" in queryPromise === false) {
        throw new Error(
          '"queryFn" must return SQL. You may have to remove `.execute()` from your query.',
        );
      }
      const queryBuilder = queryPromise as unknown as SQLWrapper;
      const query = compileQuery(queryBuilder);

      const sse = new EventSource(getUrl(baseUrl, "live", query));

      const onDataListener = async (event: MessageEvent) => {
        try {
          const result = JSON.parse(event.data);

          const drizzleShim = drizzle(
            (_, __, method) => {
              if (method === "all") {
                return Promise.resolve({
                  ...result,
                  rows: result.rows.map((row: object) => Object.values(row)),
                });
              }

              return Promise.resolve(result);
            },
            { schema: params.schema },
          );

          let data: unknown;

          if (queryBuilder instanceof TypedQueryBuilder) {
            const fields = queryBuilder._.selectedFields as Record<
              string,
              unknown
            >;
            const orderedFields = orderSelectedFields(fields);

            data = await drizzleShim._.session
              .prepareQuery(
                query,
                // @ts-expect-error
                orderedFields,
                undefined,
                false,
              )
              .execute();
          } else if (queryBuilder instanceof PgRelationalQuery) {
            // @ts-expect-error
            const selection = queryBuilder._toSQL().query.selection;
            data = await drizzleShim._.session
              .prepareQuery(
                query,
                undefined,
                undefined,
                true,
                (rawRows, mapColumnValue) => {
                  const rows = rawRows.map((row) =>
                    mapRelationalRow(
                      // @ts-expect-error
                      queryBuilder.schema,
                      // @ts-expect-error
                      queryBuilder.tableConfig,
                      row,
                      selection,
                      mapColumnValue,
                    ),
                  );
                  // @ts-expect-error
                  if (queryBuilder.mode === "first") {
                    return rows[0];
                  }
                  return rows;
                },
              )
              .execute();
          } else if (queryBuilder instanceof PgRaw) {
            data = await drizzleShim._.session
              .prepareQuery(query, undefined, undefined, false)
              .execute();
          } else if (queryBuilder instanceof PgCountBuilder) {
            data = await drizzleShim._.session.count(queryBuilder.getSQL());
          } else {
            throw new Error("Unsupported query builder");
          }

          // @ts-expect-error
          onData(data);
        } catch (error) {
          onError?.(error as Error);
        }
      };

      const onErrorListener = (_event: MessageEvent) => {
        onError?.(new Error("server disconnected"));
      };

      sse.addEventListener("message", onDataListener);
      sse.addEventListener("error", onErrorListener);

      return {
        unsubscribe: () => {
          sse.removeEventListener("message", onDataListener);
          sse.removeEventListener("error", onErrorListener);
          sse.close();
        },
      };
    },
    getStatus: async () => {
      const response = await fetch(`${new URL(baseUrl).origin}/status`);

      return response.json();
    },
  };

  return client;
};

export {
  and,
  asc,
  avg,
  avgDistinct,
  between,
  count,
  countDistinct,
  desc,
  eq,
  exists,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  max,
  min,
  ne,
  not,
  notBetween,
  notExists,
  notIlike,
  notInArray,
  notLike,
  or,
  relations,
  SQL,
  sql,
  sum,
  sumDistinct,
} from "drizzle-orm";

export {
  alias,
  except,
  exceptAll,
  intersect,
  intersectAll,
  union,
  unionAll,
} from "drizzle-orm/pg-core";

export const setDatabaseSchema = <T extends { [name: string]: unknown }>(
  schema: T,
  schemaName: string,
) => {
  for (const table of Object.values(schema)) {
    if (isTable(table)) {
      // @ts-expect-error
      table[Table.Symbol.Schema] = schemaName;
    } else if (isPgEnum(table)) {
      // @ts-expect-error
      table.schema = schemaName;
    }
  }
};

function orderSelectedFields<TColumn extends AnyColumn>(
  fields: Record<string, unknown>,
  pathPrefix?: string[],
): SelectedFieldsOrdered<TColumn> {
  return Object.entries(fields).reduce<SelectedFieldsOrdered<AnyColumn>>(
    (result, [name, field]) => {
      if (typeof name !== "string") {
        return result;
      }

      const newPath = pathPrefix ? [...pathPrefix, name] : [name];
      if (is(field, Column) || is(field, SQL) || is(field, SQL.Aliased)) {
        result.push({ path: newPath, field });
      } else if (is(field, Table)) {
        result.push(
          // @ts-expect-error
          ...orderSelectedFields(field[Table.Symbol.Columns], newPath),
        );
      } else {
        result.push(
          ...orderSelectedFields(field as Record<string, unknown>, newPath),
        );
      }
      return result;
    },
    [],
  ) as SelectedFieldsOrdered<TColumn>;
}
