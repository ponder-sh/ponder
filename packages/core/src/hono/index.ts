import type { Hono } from "hono";
import type { Handler } from "./handler.js";

export const applyPathOrHandlers = (
  hono: Hono,
  pathOrHandlers: [
    maybePathOrHandler: string | Handler,
    ...handlers: Handler[],
  ][],
) => {
  // add custom properties to hono context
  const addCustomContext = (handler: Handler) => (c: any) => {
    return handler(c);
  };

  // register collected path + handlers to the underlying hono instance
  // from https://github.com/honojs/hono/blob/main/src/hono-base.ts#L125-L142
  for (const [maybePathOrHandler, ...handlers] of pathOrHandlers) {
    let path = "/";

    if (typeof maybePathOrHandler === "string") {
      path = maybePathOrHandler;
    } else {
      // @ts-expect-error access private property
      hono.addRoute("get", path, addCustomContext(maybePathOrHandler));
    }

    for (const handler of handlers) {
      if (typeof handler !== "string") {
        // @ts-expect-error access private property
        hono.addRoute("get", path, addCustomContext(handler));
      }
    }
  }

  return hono;
};
