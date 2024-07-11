import type {
  HandlerInterface,
  MiddlewareHandlerInterface,
} from "@/hono/handler.js";
import type { Hono } from "hono";

export type PonderHono = {
  get: HandlerInterface;
  post: HandlerInterface;
  use: MiddlewareHandlerInterface;
  hono: Hono;
};
