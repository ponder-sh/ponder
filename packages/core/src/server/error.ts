import { Effect } from "effect";
import type { Context, HonoRequest } from "hono";
import { html } from "hono/html";
import { addStackTrace } from "@/indexing/addStackTrace.js";
import type { BaseError } from "@/internal/errors.js";
import { Options } from "@/internal/options.js";
import { prettyPrint } from "@/utils/print.js";

export const onError = (
  _error: Error,
  c: Context,
): Effect.Effect<Response, never, Options> =>
  Effect.gen(function* () {
    const error = _error as BaseError;

    // Find the filename where the error occurred
    const regex = /(\S+\.(?:js|ts|mjs|cjs)):\d+:\d+/;
    const matches = error.stack?.match(regex);
    const errorFile = (() => {
      if (!matches?.[0]) return undefined;
      const path = matches[0].trim();
      if (path.startsWith("(")) {
        return path.slice(1);
      } else if (path.startsWith("file://")) {
        return path.slice(7);
      }
      return path;
    })();

    addStackTrace(error, yield* Options);

    error.meta = Array.isArray(error.meta) ? error.meta : [];
    error.meta.push(
      `Request:\n${prettyPrint({
        path: c.req.path,
        method: c.req.method,
        body: yield* tryExtractRequestBody(c.req),
      })}`,
    );

    yield* Effect.logWarning({
      msg: "Failed to handle HTTP request",
      method: c.req.method,
      path: c.req.path,
      error,
    });

    // 500: Internal Server Error
    return c.text(
      `${error.name}: ${error.message} occurred in '${errorFile}' while handling a '${c.req.method}' request to the route '${c.req.path}'`,
      500,
    );
  });

export const onNotFound = (c: Context) => {
  return c.html(
    html`<!doctype html>
      <h1>Bad news!</h1>
      <p>The route "<code>${c.req.path}</code>" does not exist</p>`,
  );
};

const tryExtractRequestBody = (request: HonoRequest): Effect.Effect<unknown> =>
  Effect.tryPromise(() => request.json()).pipe(
    Effect.catch(() =>
      Effect.tryPromise(() => request.text()).pipe(
        Effect.map((text) => (text !== "" ? text : undefined)),
      ),
    ),
    Effect.orElseSucceed(() => undefined),
  );
