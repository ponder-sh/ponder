import { createServer as createNodeServer } from "node:http";
import type { Common } from "@/Ponder.js";
import type { DatabaseService } from "@/database/service.js";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ServerType } from "node_modules/@hono/node-server/dist/types.js";

type Server = {
  hono: Hono;
  server: ServerType;
};

export const createServer = ({
  common,
  database,
}: { common: Common; database: DatabaseService }): Server => {
  const hono = new Hono();

  hono.use(
    cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS", "HEAD"] }),
  );

  // TODO(kyle) cache
  hono
    .get("/metrics", async (c) => {
      try {
        const metrics = common.metrics.getMetrics();
        // res.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
        return c.json(metrics);
      } catch (error) {
        return c.json(error, 500);
      }
    })
    .get("/health", async (c) => {
      if (database.isPublished) {
        c.status(200);
        return;
      }

      const max = common.options.maxHealthcheckDuration;
      const elapsed = Math.floor(process.uptime());

      if (elapsed > max) {
        common.logger.warn({
          service: "server",
          msg: `Historical sync duration has exceeded the max healthcheck duration of ${max} seconds (current: ${elapsed}). Sevice is now responding as healthy and may serve incomplete data.`,
        });

        c.status(200);
        return;
      }

      c.status(503);
      return;
    });

  const server = serve({ fetch: hono.fetch, createServer: createNodeServer });

  return { hono, server };
};

export const killServer = async (server: Server) => {
  await new Promise((res) => server.server.close(res));
};
