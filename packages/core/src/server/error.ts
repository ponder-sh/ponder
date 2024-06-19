import type { Common } from "@/common/common.js";
import type { BaseError } from "@/common/errors.js";
import { addStackTrace } from "@/indexing/addStackTrace.js";
import { prettyPrint } from "@/utils/print.js";
import type { Context, HonoRequest } from "hono";
import { html } from "hono/html";

export const onError = async (_error: Error, c: Context, common: Common) => {
  const error = _error as BaseError;

  // Find the filenames of the first three items of the stack
  const regex = /(\S+\.(?:js|ts|mjs|cjs)):\d+:\d+/g;
  const matches = error.stack?.match(regex);
  const stack = matches
    ?.map((m) => {
      const path = m.trim();
      if (path.startsWith("(")) {
        return path.slice(1);
      } else if (path.startsWith("file://")) {
        return path.slice(7);
      }
      return path;
    })
    ?.slice(0, 3);

  addStackTrace(error, common.options);

  error.meta = Array.isArray(error.meta) ? error.meta : [];
  error.meta.push(
    `Request:\n${prettyPrint({
      path: c.req.path,
      method: c.req.method,
      body: await tryExtractRequestBody(c.req),
    })}`,
  );

  common.logger.warn({
    service: "server",
    msg: `An error occurred while handling a '${c.req.method}' request to the route '${c.req.path}'`,
    error,
  });

  // 500: Internal Server Error
  return c.json(
    {
      name: error.name,
      message: error.message,
      meta: error.meta,
      stack,
    },
    500,
  );
};

export const onNotFound = (c: Context) => {
  return c.html(
    html`<!doctype html>
      <h1>Bad news!</h1>
      <p>The route "<code>${c.req.path}</code>" does not exist</p>`,
  );
};

const tryExtractRequestBody = async (request: HonoRequest) => {
  //
  try {
    return await request.json();
  } catch {
    try {
      const text = await request.text();
      if (text !== "") return text;
    } catch {}
  }
  return undefined;
};
