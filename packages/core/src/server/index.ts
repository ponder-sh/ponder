import http from "node:http";
import { serve } from "@hono/node-server";
import { Deferred, Effect, type Scope } from "effect";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import { Db } from "@/database/db.js";
import {
  getPonderCheckpointTable,
  getPonderMetaTable,
} from "@/database/index.js";
import { externalIo } from "@/internal/io.js";
import { Metrics } from "@/internal/metrics.js";
import type { Options } from "@/internal/options.js";
import type { ApiBuild, Status } from "@/internal/types.js";
import { decodeCheckpoint } from "@/utils/checkpoint.js";
import { startClockEffect } from "@/utils/timer.js";
import { onError } from "./error.js";

export type Server = {
  hono: Hono;
};

/**
 * Start the HTTP server, with the internal routes (`/metrics`, `/health`,
 * `/ready`, `/status`) and the routes of the API build. Closing the scope
 * stops it.
 */
export const makeServer = (
  apiBuild: ApiBuild,
): Effect.Effect<Server, Error, Db | Metrics | Options | Scope.Scope> =>
  Effect.gen(function* () {
    const db = yield* Db;
    const metrics = yield* Metrics;
    const runPromise = Effect.runPromiseWith(yield* Effect.context<Options>());

    const metricsMiddleware = createMiddleware((c, next) =>
      runPromise(
        Effect.gen(function* () {
          const matchedPathLabels = c.req.matchedRoutes
            // Filter out global middlewares
            .filter((r) => r.path !== "/*")
            .map((r) => ({ method: c.req.method, path: r.path }));

          for (const labels of matchedPathLabels) {
            metrics.ponder_http_server_active_requests.inc(labels);
          }
          const endClock = yield* startClockEffect;

          yield* Effect.tryPromise({
            try: () => next(),
            catch: (error) => error,
          }).pipe(
            Effect.ensuring(
              Effect.gen(function* () {
                const requestSize = Number(c.req.header("Content-Length") ?? 0);
                const responseSize = Number(
                  c.res.headers.get("Content-Length") ?? 0,
                );
                const responseDuration = yield* endClock;
                const status =
                  c.res.status >= 200 && c.res.status < 300
                    ? "2XX"
                    : c.res.status >= 300 && c.res.status < 400
                      ? "3XX"
                      : c.res.status >= 400 && c.res.status < 500
                        ? "4XX"
                        : "5XX";

                for (const labels of matchedPathLabels) {
                  metrics.ponder_http_server_active_requests.dec(labels);
                  metrics.ponder_http_server_request_size_bytes.observe(
                    { ...labels, status },
                    requestSize,
                  );
                  metrics.ponder_http_server_response_size_bytes.observe(
                    { ...labels, status },
                    responseSize,
                  );
                  metrics.ponder_http_server_request_duration_ms.observe(
                    { ...labels, status },
                    responseDuration,
                  );
                }
              }),
            ),
          );
        }),
      ),
    );

    const hono = new Hono()
      .use(metricsMiddleware)
      .use(cors({ origin: "*", maxAge: 86400 }))
      .get("/metrics", (c) =>
        runPromise(
          Effect.tryPromise({
            try: () => metrics.getMetrics(),
            catch: (error) => error,
          }).pipe(
            Effect.match({
              onSuccess: (metrics) => c.text(metrics),
              onFailure: (error) => c.json(error as Error, 500),
            }),
          ),
        ),
      )
      .get("/health", (c) => {
        return c.text("", 200);
      })
      .get("/ready", (c) =>
        runPromise(
          Effect.gen(function* () {
            const isReady = yield* db.readonly.query(
              (db) =>
                db
                  .select()
                  .from(getPonderMetaTable())
                  .then((result) => result[0]!.value.is_ready === 1),
              { label: "select_ready" },
            );
            if (isReady) {
              return c.text("", 200);
            }

            return c.text("Historical indexing is not complete.", 503);
          }),
        ),
      )
      .get("/status", (c) =>
        runPromise(
          Effect.gen(function* () {
            const checkpoints = yield* db.readonly.query(
              (db) => db.select().from(getPonderCheckpointTable()),
              { label: "select_checkpoints" },
            );
            const status: Status = {};
            for (const {
              chainName,
              chainId,
              latestCheckpoint,
            } of checkpoints.sort((a, b) => (a.chainId > b.chainId ? 1 : -1))) {
              status[chainName] = {
                id: chainId,
                block: {
                  number: Number(
                    decodeCheckpoint(latestCheckpoint).blockNumber,
                  ),
                  timestamp: Number(
                    decodeCheckpoint(latestCheckpoint).blockTimestamp,
                  ),
                },
              };
            }
            return c.json(status);
          }),
        ),
      )
      .route("/", apiBuild.app)
      .onError((error, c) => runPromise(onError(error, c)));

    const endClock = yield* startClockEffect;

    yield* Effect.acquireRelease(
      externalIo(listen(hono, apiBuild)),
      (httpServer) => externalIo(close(httpServer)),
    );

    metrics.port = apiBuild.port;
    yield* Effect.logInfo({
      msg: "Created HTTP server",
      port: apiBuild.port,
      hostname: apiBuild.hostname,
      duration: yield* endClock,
    });
    yield* Effect.logInfo({
      msg: "Started returning 200 responses",
      endpoint: "/health",
    });

    return { hono };
  });

/**
 * Create a Node.js server for `hono` and wait until it listens.
 *
 * @dev The server has no `error` listener, so an error such as `EADDRINUSE` is
 * an uncaught exception.
 */
const listen = (
  hono: Hono,
  apiBuild: ApiBuild,
): Effect.Effect<http.Server, Error> =>
  Effect.callback<http.Server>((resume) => {
    const httpServer = serve(
      {
        fetch: hono.fetch,
        createServer: http.createServer,
        port: apiBuild.port,
        // Note that `apiBuild.hostname` can be undefined if the user did not specify one.
        // In this case, Node.js uses `::` if IPv6 is available and `0.0.0.0` otherwise.
        // https://nodejs.org/api/net.html#serverlistenport-host-backlog-callback
        hostname: apiBuild.hostname,
      },
      () => resume(Effect.succeed(httpServer as http.Server)),
    );

    // Note: Only runs if the timeout interrupts the start. Once the server
    // listens, `close` stops it.
    return Effect.sync(() => {
      httpServer.close();
    });
  }).pipe(
    Effect.timeoutOrElse({
      duration: 5_000,
      orElse: () =>
        Effect.fail(new Error("HTTP server failed to start within 5 seconds.")),
    }),
  );

/**
 * Stop accepting connections and close idle connections. Connections that are
 * still open after 1 second are closed.
 */
const close = (httpServer: http.Server): Effect.Effect<void> =>
  Effect.gen(function* () {
    const closed = yield* Deferred.make<void>();
    httpServer.close(() => {
      Deferred.doneUnsafe(closed, Effect.void);
    });
    httpServer.closeIdleConnections();

    yield* Deferred.await(closed).pipe(
      Effect.timeoutOrElse({
        duration: 1_000,
        orElse: () =>
          Effect.sync(() => httpServer.closeAllConnections()).pipe(
            Effect.andThen(Deferred.await(closed)),
          ),
      }),
    );
  });
