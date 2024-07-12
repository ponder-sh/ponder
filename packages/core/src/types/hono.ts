import type {
  HandlerInterface,
  MiddlewareHandlerInterface,
} from "@/hono/handler.js";
import type { Schema } from "@/schema/common.js";
import type { Hono } from "hono";

export type PonderHono<schema extends Schema> = {
  get: HandlerInterface<schema>;
  post: HandlerInterface<schema>;
  use: MiddlewareHandlerInterface<schema>;
  hono: Hono;
};
