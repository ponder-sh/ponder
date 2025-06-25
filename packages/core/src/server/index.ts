import http from "node:http";
import {
  type Database,
  getPonderCheckpointTable,
  getPonderMetaTable,
} from "@/database/index.js";
import type { Common } from "@/internal/common.js";
import type { ApiBuild, Status } from "@/internal/types.js";
import { decodeCheckpoint } from "@/utils/checkpoint.js";
import { startClock } from "@/utils/timer.js";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import { createHttpTerminator } from "http-terminator";
import { onError } from "./error.js";

export type Server = {
  hono: Hono;
};

export async function createServer({
  common,
  database,
  apiBuild,
}: {
  common: Common;
  database: Database;
  apiBuild: ApiBuild;
}): Promise<Server> {
  const metricsMiddleware = createMiddleware(async (c, next) => {
    const matchedPathLabels = c.req.matchedRoutes
      // Filter out global middlewares
      .filter((r) => r.path !== "/*")
      .map((r) => ({ method: c.req.method, path: r.path }));

    for (const labels of matchedPathLabels) {
      common.metrics.ponder_http_server_active_requests.inc(labels);
    }
    const endClock = startClock();

    try {
      await next();
    } finally {
      const requestSize = Number(c.req.header("Content-Length") ?? 0);
      const responseSize = Number(c.res.headers.get("Content-Length") ?? 0);
      const responseDuration = endClock();
      const status =
        c.res.status >= 200 && c.res.status < 300
          ? "2XX"
          : c.res.status >= 300 && c.res.status < 400
            ? "3XX"
            : c.res.status >= 400 && c.res.status < 500
              ? "4XX"
              : "5XX";

      for (const labels of matchedPathLabels) {
        common.metrics.ponder_http_server_active_requests.dec(labels);
        common.metrics.ponder_http_server_request_size_bytes.observe(
          { ...labels, status },
          requestSize,
        );
        common.metrics.ponder_http_server_response_size_bytes.observe(
          { ...labels, status },
          responseSize,
        );
        common.metrics.ponder_http_server_request_duration_ms.observe(
          { ...labels, status },
          responseDuration,
        );
      }
    }
  });

  const hono = new Hono()
    .use(metricsMiddleware)
    .use(cors({ origin: "*", maxAge: 86400 }))
    .get("/metrics", async (c) => {
      try {
        const metrics = await common.metrics.getMetrics();
        return c.text(metrics);
      } catch (error) {
        return c.json(error as Error, 500);
      }
    })
    .get("/health", (c) => {
      return c.text("", 200);
    })
    .get("/ready", async (c) => {
      const isReady = await database
        .readonlyQB("select_ready")
        .select()
        .from(getPonderMetaTable())
        .then((result) => result[0]!.value.is_ready === 1);

      if (isReady) {
        return c.text("", 200);
      }

      return c.text("Historical indexing is not complete.", 503);
    })
    .get("/status", async (c) => {
      const checkpoints = await database
        .readonlyQB("select_checkpoints")
        .select()
        .from(getPonderCheckpointTable());
      const status: Status = {};
      for (const { chainName, chainId, latestCheckpoint } of checkpoints) {
        status[chainName] = {
          id: chainId,
          block: {
            number: Number(decodeCheckpoint(latestCheckpoint).blockNumber),
            timestamp: Number(
              decodeCheckpoint(latestCheckpoint).blockTimestamp,
            ),
          },
        };
      }
      return c.json(status);
    })
    .route("/", apiBuild.app)
    .onError((error, c) => onError(error, c, common));

  // Create nodejs server

  const httpServer = await new Promise<http.Server>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("HTTP server failed to start within 5 seconds."));
    }, 5_000);

    const httpServer = serve(
      {
        fetch: hono.fetch,
        createServer: http.createServer,
        port: apiBuild.port,
        // Note that common.options.hostname can be undefined if the user did not specify one.
        // In this case, Node.js uses `::` if IPv6 is available and `0.0.0.0` otherwise.
        // https://nodejs.org/api/net.html#serverlistenport-host-backlog-callback
        hostname: apiBuild.hostname,
      },
      () => {
        clearTimeout(timeout);
        common.metrics.ponder_http_server_port.set(apiBuild.port);
        common.logger.info({
          service: "server",
          msg: `Started listening on port ${apiBuild.port}`,
        });
        common.logger.info({
          service: "server",
          msg: "Started returning 200 responses from /health endpoint",
        });
        resolve(httpServer as http.Server);
      },
    );
  });

  const terminator = createHttpTerminator({
    server: httpServer,
    gracefulTerminationTimeout: 1000,
  });

  common.shutdown.add(() => terminator.terminate());

  return { hono };
}
