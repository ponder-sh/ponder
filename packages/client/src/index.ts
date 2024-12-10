import { type PgRemoteDatabase, drizzle } from "drizzle-orm/pg-proxy";

type Schema = { [name: string]: unknown };

export type Client<schema extends Schema = Schema> = {
  db: PgRemoteDatabase<schema>;
};

export const createClient = <schema extends Schema>({
  url,
  schema,
}: { url: string; schema: schema }): Client<schema> => {
  const db = drizzle(
    async (sql, params, method, typings) => {
      const result = await fetch(url, {
        method: "POST",
        body: JSON.stringify({ sql, params, method, typings }),
      });

      // TODO(kyle) parse bigints

      return await result.json();
    },
    { schema, casing: "snake_case" },
  );

  return { db };
};
