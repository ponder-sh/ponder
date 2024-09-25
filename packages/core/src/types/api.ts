import type { Drizzle } from "@/drizzle/index.js";
import type {
  HandlerInterface,
  MiddlewareHandlerInterface,
} from "@/hono/handler.js";
import type { Hono } from "hono";

export type ApiRegistry = {
  get: HandlerInterface;
  post: HandlerInterface;
  use: MiddlewareHandlerInterface;
  hono: Hono<{
    Variables: {
      db: Drizzle;
    };
  }>;
};
