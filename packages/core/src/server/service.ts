import http from "node:http";
import type { Common } from "@/common/common.js";
import type { IndexingStore } from "@/indexing-store/store.js";
import { graphiQLHtml } from "@/ui/graphiql.html.js";
import { graphqlServer } from "@hono/graphql-server";
import { serve } from "@hono/node-server";
import { GraphQLError, type GraphQLSchema } from "graphql";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createHttpTerminator } from "http-terminator";
import {
  type GetLoader,
  buildLoaderCache,
} from "./graphql/buildLoaderCache.js";

type Server = {
  hono: Hono<{ Variables: { store: IndexingStore; getLoader: GetLoader } }>;
  port: number;
  setHealthy: () => void;
  kill: () => Promise<void>;
};

export const createServer = ({
  graphqlSchema,
  indexingStore,
  common,
}: {
  graphqlSchema: GraphQLSchema;
  indexingStore: IndexingStore;
  common: Common;
}): Server => {
  const hono = new Hono<{
    Variables: { store: IndexingStore; getLoader: GetLoader };
  }>();
  let port = common.options.port;

  let isHealthy = false;
  let kill: () => Promise<void>;

  hono
    .use(cors())
    .get("/metrics", async (c) => {
      try {
        const metrics = await common.metrics.getMetrics();
        return c.text(metrics);
      } catch (error) {
        return c.json(error, 500);
      }
    })
    .get("/health", async (c) => {
      if (isHealthy) {
        c.status(200);
        return c.text("");
      }

      const max = common.options.maxHealthcheckDuration;
      const elapsed = Math.floor(process.uptime());

      if (elapsed > max) {
        common.logger.warn({
          service: "server",
          msg: `Historical sync duration has exceeded the max healthcheck duration of ${max} seconds (current: ${elapsed}). Sevice is now responding as healthy and may serve incomplete data.`,
        });

        c.status(200);
        return c.text("");
      }

      c.status(503);
      return c.text("Historical indexing is not complete.");
    })
    .use("/graphql", async (c, next) => {
      if (isHealthy === false) {
        c.status(503);
        return c.json({
          data: undefined,
          errors: [new GraphQLError("Historical indexing in not complete")],
        });
      }

      if (c.req.method === "POST") {
        const getLoader = buildLoaderCache({ store: indexingStore });

        c.set("store", indexingStore);
        c.set("getLoader", getLoader);

        return graphqlServer({
          schema: graphqlSchema,
        })(c);
      }
      return next();
    })
    .get("/graphql", (c) => {
      return c.html(graphiQLHtml);
    })
    .use("/", async (c, next) => {
      if (c.req.method === "POST") {
        const getLoader = buildLoaderCache({ store: indexingStore });

        c.set("store", indexingStore);
        c.set("getLoader", getLoader);

        return graphqlServer({
          schema: graphqlSchema,
        })(c);
      }
      return next();
    })
    .get("/", (c) => {
      return c.html(graphiQLHtml);
    });

  function createServerInner(...args: Parameters<typeof http.createServer>) {
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
      common.metrics.ponder_server_port.set(port);
      common.logger.info({
        service: "server",
        msg: `Started listening on port ${port}`,
      });
      httpServer.off("error", errorHandler);
    };

    httpServer.on("error", errorHandler);
    httpServer.on("listening", listenerHandler);

    kill = createHttpTerminator({ server: httpServer }).terminate;

    return httpServer;
  }

  serve({
    fetch: hono.fetch,
    createServer: createServerInner as any,
    port,
    // Note that common.options.hostname can be undefined if the user did not specify one.
    // In this case, Node.js uses `::` if IPv6 is available and `0.0.0.0` otherwise.
    // https://nodejs.org/api/net.html#serverlistenport-host-backlog-callback
    hostname: common.options.hostname,
  });

  return {
    hono,
    port,

    setHealthy: () => {
      isHealthy = true;
    },
    kill: kill!,
  };
};
