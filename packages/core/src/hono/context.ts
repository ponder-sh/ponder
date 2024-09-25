import type { Drizzle } from "@/drizzle/index.js";
import type { Env, Context as HonoContext, Input } from "hono";

export type Context<path extends string = string, input extends Input = {}> = {
  db: Drizzle;
} & {
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
  path extends string = string,
  input extends Input = {},
> = {
  db: Drizzle;
} & HonoContext<Env, path, input>;
