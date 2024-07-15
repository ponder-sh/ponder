import type { DrizzleDb } from "@/drizzle/db.js";
import type { ConvertToDrizzleTable } from "@/drizzle/table.js";
import type { ExtractTableNames, Schema } from "@/schema/common.js";
import type { Env, Context as HonoContext, Input } from "hono";

export type Context<
  schema extends Schema = Schema,
  path extends string = string,
  input extends Input = {},
> = {
  db: DrizzleDb;
  tables: {
    [tableName in ExtractTableNames<schema>]: ConvertToDrizzleTable<
      tableName,
      // @ts-ignore
      schema[tableName]["table"],
      schema
    >;
  };
  /**
   * Hono request object.
   *
   * @see https://hono.dev/docs/api/context#req
   */
  req: HonoContext<Env, path, input>["req"];
  /**
   * Hono response object.
   *
   * @see https://hono.dev/docs/api/context#res
   */
  res: HonoContext<Env, path, input>["req"];
  /**
   * Return the HTTP response.
   *
   * @see https://hono.dev/docs/api/context#body
   */
  body: HonoContext<Env, path, input>["body"];
  /**
   * Render text as `Content-Type:text/plain`.
   *
   * @see https://hono.dev/docs/api/context#text
   */
  text: HonoContext<Env, path, input>["text"];
  /**
   * Render JSON as `Content-Type:application/json`.
   *
   * @see https://hono.dev/docs/api/context#json
   */
  json: HonoContext<Env, path, input>["json"];
  /**
   * Hono redirect.
   *
   * @see https://hono.dev/docs/api/context#redirect
   */
  redirect: HonoContext<Env, path, input>["redirect"];
};

export type MiddlewareContext<
  schema extends Schema = Schema,
  path extends string = string,
  input extends Input = {},
> = HonoContext<Env, path, input> & {
  db: DrizzleDb;
  tables: {
    [tableName in ExtractTableNames<schema>]: ConvertToDrizzleTable<
      tableName,
      // @ts-ignore
      schema[tableName]["table"],
      schema
    >;
  };
};
