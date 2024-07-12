import http from "node:http";
import type { Common } from "@/common/common.js";
import type { MetadataStore, ReadonlyStore } from "@/indexing-store/store.js";
import { graphiQLHtml } from "@/ui/graphiql.html.js";
import { startClock } from "@/utils/timer.js";
import { maxAliasesPlugin } from "@escape.tech/graphql-armor-max-aliases";
import { maxDepthPlugin } from "@escape.tech/graphql-armor-max-depth";
import { maxTokensPlugin } from "@escape.tech/graphql-armor-max-tokens";
import { serve } from "@hono/node-server";
import { GraphQLError, type GraphQLSchema } from "graphql";
import { createYoga } from "graphql-yoga";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import { createHttpTerminator } from "http-terminator";
import {
  type GetLoader,
  buildLoaderCache,
} from "./graphql/buildLoaderCache.js";

type Server = {
  hono: Hono<{ Variables: { store: ReadonlyStore; getLoader: GetLoader } }>;
  port: number;
  kill: () => Promise<void>;
};

export async function createServer({
  graphqlSchema,
  readonlyStore,
  metadataStore,
  common,
}: {
  graphqlSchema: GraphQLSchema;
  readonlyStore: ReadonlyStore;
  metadataStore: MetadataStore;
  common: Common;
}): Promise<Server> {
  const hono = new Hono<{
    Variables: { store: ReadonlyStore; getLoader: GetLoader };
  }>();

  let port = common.options.port;
  const startTime = Date.now();

  const metricsMiddleware = createMiddleware(async (c, next) => {
    const commonLabels = { method: c.req.method, path: c.req.path };
    common.metrics.ponder_http_server_active_requests.inc(commonLabels);
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

      common.metrics.ponder_http_server_active_requests.dec(commonLabels);
      common.metrics.ponder_http_server_request_size_bytes.observe(
        { ...commonLabels, status },
        requestSize,
      );
      common.metrics.ponder_http_server_response_size_bytes.observe(
        { ...commonLabels, status },
        responseSize,
      );
      common.metrics.ponder_http_server_request_duration_ms.observe(
        { ...commonLabels, status },
        responseDuration,
      );
    }
  });

  const createGraphqlYoga = (path: string) =>
    createYoga({
      schema: graphqlSchema,
      context: () => {
        const getLoader = buildLoaderCache({ store: readonlyStore });
        return { getLoader, readonlyStore, metadataStore };
      },
      graphqlEndpoint: path,
      maskedErrors: process.env.NODE_ENV === "production",
      logging: false,
      graphiql: false,
      parserAndValidationCache: false,
      plugins: [
        maxTokensPlugin({ n: common.options.graphqlMaxOperationTokens }),
        maxDepthPlugin({
          n: common.options.graphqlMaxOperationDepth,
          ignoreIntrospection: false,
        }),
        maxAliasesPlugin({
          n: common.options.graphqlMaxOperationAliases,
          allowList: [],
        }),
      ],
    });

  const rootYoga = createGraphqlYoga("/");
  const rootGraphiql = graphiQLHtml("/");

  const prodYoga = createGraphqlYoga("/graphql");
  const prodGraphiql = graphiQLHtml("/graphql");

  hono
    .use(cors())
    .use(metricsMiddleware)
    .get("/metrics", async (c) => {
      try {
        const metrics = await common.metrics.getMetrics();
        return c.text(metrics);
      } catch (error) {
        return c.json(error as Error, 500);
      }
    })
    .get("/health", async (c) => {
      const status = await metadataStore.getStatus();

      if (
        status !== null &&
        Object.values(status).every(({ ready }) => ready === true)
      ) {
        return c.text("", 200);
      }

      const elapsed = (Date.now() - startTime) / 1000;
      const max = common.options.maxHealthcheckDuration;

      if (elapsed > max) {
        common.logger.warn({
          service: "server",
          msg: `Historical indexing duration has exceeded the max healthcheck duration of ${max} seconds (current: ${elapsed}). Sevice is now responding as healthy and may serve incomplete data.`,
        });
        return c.text("", 200);
      }

      return c.text("Historical indexing is not complete.", 503);
    })
    // Renders GraphiQL
    .get("/graphql", (c) => c.html(prodGraphiql))
    // Serves GraphQL POST requests following healthcheck rules
    .post("/graphql", async (c) => {
      const status = await metadataStore.getStatus();
      if (
        status === null ||
        Object.values(status).some(({ ready }) => ready === false)
      ) {
        return c.json(
          { errors: [new GraphQLError("Historical indexing is not complete")] },
          503,
        );
      }

      return prodYoga.handle(c.req.raw);
    })
    // Renders GraphiQL
    .get("/", (c) => c.html(rootGraphiql))
    // Serves GraphQL POST requests regardless of health status, e.g. "dev UI"
    .post("/", (c) => rootYoga.handle(c.req.raw))
    .get("/status", async (c) => {
      const status = await metadataStore.getStatus();

      return c.json(status);
    });

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
