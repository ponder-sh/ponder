import http from "node:http";
import type { Common } from "@/common/common.js";
import type { IndexingStore } from "@/indexing-store/store.js";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createHttpTerminator } from "http-terminator";
import { buildLoaderCache } from "../graphql/loader.js";

type Server = {
  hono: Hono;
  port: number;
  setHealthy: () => void;
  kill: () => Promise<void>;
};

export async function createServer({
  indexingStore,
  common,
  hono: _hono,
}: {
  indexingStore: IndexingStore;
  common: Common;
  hono: Hono | undefined;
}): Promise<Server> {
  const hono = _hono ?? new Hono();

  let port = common.options.port;
  let isHealthy = false;

  hono
    .use(cors())
    .use(async (c, next) => {
      const getLoader = buildLoaderCache({ store: indexingStore });

      // @ts-ignore
      c.set("store", indexingStore);
      // @ts-ignore
      c.set("getLoader", getLoader);

      return await next();
    })
    .get("/_ponder/metrics", async (c) => {
      try {
        const metrics = await common.metrics.getMetrics();
        return c.text(metrics);
      } catch (error) {
        return c.json(error, 500);
      }
    })
    .get("/_ponder/health", async (c) => {
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
      common.metrics.ponder_server_port.set(port);
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
    setHealthy: () => {
      isHealthy = true;
    },
    kill: () => terminator.terminate(),
  };
}
