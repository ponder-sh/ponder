import type { Hono } from "hono";
import type { Handler, MiddlewareHandler } from "./handler.js";

export type PonderRoutes = {
  method: "GET" | "POST" | "USE";
  pathOrHandlers: [
    maybePathOrHandler: string | Handler | MiddlewareHandler,
    ...handlers: (Handler | MiddlewareHandler)[],
  ];
}[];

export const applyHonoRoutes = (
  hono: Hono,
  routes: PonderRoutes,
  customContext?: object,
) => {
  // add custom properties to hono context
  const customContextWrapper =
    (handler: Handler | MiddlewareHandler) => (c: any, next: any) => {
      for (const key of Object.keys(customContext ?? {})) {
        // @ts-ignore
        c[key] = customContext![key];
      }

      return handler(c, next);
    };

  for (const {
    method,
    pathOrHandlers: [maybePathOrHandler, ...handlers],
  } of routes) {
    let path = "/";
    if (method === "GET" || method === "POST") {
      // register collected "GET" or "POST" path + handlers to the underlying hono instance
      // from https://github.com/honojs/hono/blob/main/src/hono-base.ts#L125-L142
      if (typeof maybePathOrHandler === "string") {
        path = maybePathOrHandler;
      } else {
        hono[method === "GET" ? "get" : "put"](
          path,
          customContextWrapper(maybePathOrHandler),
        );
      }

      for (const handler of handlers) {
        if (typeof handler !== "string") {
          hono[method === "GET" ? "get" : "put"](
            path,
            customContextWrapper(handler),
          );
        }
      }
    } else {
      // register collected middleware to the underlying hono instance
      // from: https://github.com/honojs/hono/blob/main/src/hono-base.ts#L158-L169
      if (typeof maybePathOrHandler === "string") {
        path = maybePathOrHandler;
      } else {
        path = "*";
        handlers.unshift(maybePathOrHandler);
      }
      for (const handler of handlers) {
        hono.use(path, customContextWrapper(handler));
      }
    }
  }

  return hono;
};
