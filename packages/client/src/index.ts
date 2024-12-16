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

export const createClient = <schema extends Schema>(
  url: string,
  { schema }: { schema: schema },
): Client<schema> => {
  const db = drizzle(
    async (sql, params, method, typings) => {
      const result = await fetch(url, {
        method: "POST",
        body: JSON.stringify({ sql, params, method, typings }),
      });

      return await result.json();
    },
    { schema, casing: "snake_case" },
  );

  return { db };
};
