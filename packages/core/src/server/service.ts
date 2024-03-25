import { createServer as createNodeServer } from "node:http";
import type { Common } from "@/common/common.js";
import type { IndexingStore } from "@/indexing-store/store.js";
import { graphqlServer } from "@hono/graphql-server";
import { serve } from "@hono/node-server";
import type { GraphQLSchema } from "graphql";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { type GetLoader, buildLoaderCache } from "./graphql/loaders.js";

type Server = {
  hono: Hono<{ Variables: { store: IndexingStore; getLoader: GetLoader } }>;
  // Note(kevin) might need this property for kill
  // server: ReturnType<typeof serve>;
  isHealthy: boolean;
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

  const server = { hono, isHealthy: false };

  hono
    .use(cors())
    // .get("/metrics", async (c) => {
    //   try {
    //     const metrics = common.metrics.getMetrics();
    //     // res.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    //     return c.json(metrics);
    //   } catch (error) {
    //     return c.json(error, 500);
    //   }
    // })
    .get("/health", async (c, next) => {
      if (server.isHealthy) {
        c.status(200);
        return next();
      }

      const max = common.options.maxHealthcheckDuration;
      const elapsed = Math.floor(process.uptime());

      if (elapsed > max) {
        common.logger.warn({
          service: "server",
          msg: `Historical sync duration has exceeded the max healthcheck duration of ${max} seconds (current: ${elapsed}). Sevice is now responding as healthy and may serve incomplete data.`,
        });

        c.status(200);
        return next();
      }

      c.status(503);
      return c.text("Historical indexing is not complete.");
    })
    .use("/graphql", async (c, next) => {
      const { getLoader } = buildLoaderCache({ store: indexingStore });

      c.set("store", indexingStore);
      c.set("getLoader", getLoader);

      await next();
    })
    .use(
      "/graphql",
      graphqlServer({
        schema: graphqlSchema,
      }),
    );

  // TODO(kyle) cache
  // TODO(kevin) find port
  // TODO(kyle) graphIql

  serve({ fetch: hono.fetch, createServer: createNodeServer });

  return server;
};

export const setHealthy = (server: Server) => {
  server.isHealthy = true;
};

export const killServer = async (_server: Server) => {
  // TODO(kevin)
};
