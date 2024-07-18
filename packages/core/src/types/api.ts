import type { DrizzleDb } from "@/drizzle/db.js";
import type { DrizzleTable } from "@/drizzle/table.js";
import type {
  HandlerInterface,
  MiddlewareHandlerInterface,
} from "@/hono/handler.js";
import type { ExtractTableNames, Schema } from "@/schema/common.js";
import type { Hono } from "hono";

export type ApiContext<schema extends Schema> = {
  db: DrizzleDb;
  tables: {
    [tableName in ExtractTableNames<schema>]: DrizzleTable<
      tableName,
      // @ts-ignore
      schema[tableName]["table"],
      schema
    >;
  };
};

export type ApiRegistry<schema extends Schema> = {
  get: HandlerInterface<schema>;
  post: HandlerInterface<schema>;
  use: MiddlewareHandlerInterface<schema>;
  hono: Hono<{ Variables: ApiContext<schema> }>;
};
