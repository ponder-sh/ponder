import type { Drizzle, Schema } from "@/drizzle/index.js";
import type {
  HandlerInterface,
  MiddlewareHandlerInterface,
} from "@/hono/handler.js";
import type { Hono } from "hono";

export type ApiRegistry<schema extends Schema> = {
  get: HandlerInterface<schema>;
  post: HandlerInterface<schema>;
  use: MiddlewareHandlerInterface<schema>;
  hono: Hono<{
    Variables: {
      db: Drizzle<schema>;
    };
  }>;
};
