import http from "node:http";
import type { Common } from "@/common/common.js";
import type { Database } from "@/database/index.js";
import { graphql } from "@/graphql/middleware.js";
import { type PonderRoutes, applyHonoRoutes } from "@/hono/index.js";
import {
  getLiveMetadataStore,
  getMetadataStore,
} from "@/indexing-store/metadata.js";
import { startClock } from "@/utils/timer.js";
import { serve } from "@hono/node-server";
import type { GraphQLSchema } from "graphql";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import { createHttpTerminator } from "http-terminator";
import { onError } from "./error.js";

type Server = {
  hono: Hono;
  port: number;
  kill: () => Promise<void>;
};

export async function createServer({
  app: userApp,
  routes: userRoutes,
  common,
  graphqlSchema,
  database,
  instanceId,
}: {
  app: Hono;
  routes: PonderRoutes;
  common: Common;
  graphqlSchema: GraphQLSchema;
  database: Database;
  instanceId?: string;
}): Promise<Server> {
  // Create hono app

  const metadataStore =
    instanceId === undefined
      ? getLiveMetadataStore({ db: database.qb.readonly })
      : getMetadataStore({
          db: database.qb.readonly,
          instanceId,
        });

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

  // context required for graphql middleware and hono middleware
  const contextMiddleware = createMiddleware(async (c, next) => {
    c.set("db", database.drizzle);
    c.set("metadataStore", metadataStore);
    c.set("graphqlSchema", graphqlSchema);
    await next();
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
      const status = await metadataStore.getStatus();

      if (
        status !== null &&
        Object.values(status).every(({ ready }) => ready === true)
      ) {
        return c.text("", 200);
      }

      return c.text("Historical indexing is not complete.", 503);
    })
    .get("/status", async (c) => {
      const status = await metadataStore.getStatus();

      return c.json(status);
    })
    .use(contextMiddleware);

  if (userRoutes.length === 0 && userApp.routes.length === 0) {
    // apply graphql middleware if no custom api exists
    hono.use("/graphql", graphql());
    hono.use("/", graphql());
  } else {
    // apply user routes to hono instance, registering a custom error handler
    applyHonoRoutes(hono, userRoutes, { db: database.drizzle }).onError(
      (error, c) => onError(error, c, common),
    );

    common.logger.debug({
      service: "server",
      msg: `Detected a custom server with routes: [${userRoutes
        .map(({ pathOrHandlers: [maybePathOrHandler] }) => maybePathOrHandler)
        .filter((maybePathOrHandler) => typeof maybePathOrHandler === "string")
        .join(", ")}]`,
    });

    hono.route("/", userApp);
  }

  // Create nodejs server

  let port = common.options.port;

  const createServerWithNextAvailablePort: typeof http.createServer = (
    ...args: any
  ) => {
    const httpServer = http.createServer(...args);

    const errorHandler = (error: Error & { code: string }) => {
      if (error.code === "EADDRINUSE") {
        common.logger.warn({
          service: "server",
          msg: `Port ${port} was in use, trying port ${port + 1}`,
        });
        port += 1;
        setTimeout(() => {
          httpServer.close();
          httpServer.listen(port, common.options.hostname);
        }, 5);
      }
    };

    const listenerHandler = () => {
      common.metrics.ponder_http_server_port.set(port);
      common.logger.info({
        service: "server",
        msg: `Started listening on port ${port}`,
      });
      httpServer.off("error", errorHandler);
    };

    httpServer.on("error", errorHandler);
    httpServer.on("listening", listenerHandler);

    return httpServer;
  };

  const httpServer = await new Promise<http.Server>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("HTTP server failed to start within 5 seconds."));
    }, 5_000);

    const httpServer = serve(
      {
        fetch: hono.fetch,
        createServer: createServerWithNextAvailablePort,
        port,
        // Note that common.options.hostname can be undefined if the user did not specify one.
        // In this case, Node.js uses `::` if IPv6 is available and `0.0.0.0` otherwise.
        // https://nodejs.org/api/net.html#serverlistenport-host-backlog-callback
        hostname: common.options.hostname,
      },
      () => {
        clearTimeout(timeout);
        resolve(httpServer as http.Server);
      },
    );
  });

  const terminator = createHttpTerminator({
    server: httpServer,
    gracefulTerminationTimeout: 1000,
  });

  return {
    hono,
    port,
    kill: () => terminator.terminate(),
  };
}
