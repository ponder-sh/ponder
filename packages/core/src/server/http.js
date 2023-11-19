import { createServer } from "node:http";

import cors from "cors";
import express from "express";
import { createHttpTerminator } from "http-terminator";

console.log(`worker pid=${process.pid}`);

const app = express();

app.use(cors({ methods: ["GET", "POST", "OPTIONS", "HEAD"] }));

// Collect request/response size and latency metrics.
// app.use((req, res, next) => {
//   const endClock = startClock();
//   res.on("finish", () => {
//     const responseDuration = endClock();
//     const method = req.method;
//     const path = new URL(req.url, `http://${req.get("host")}`).pathname;
//     const status =
//       res.statusCode >= 200 && res.statusCode < 300
//         ? "2XX"
//         : res.statusCode >= 300 && res.statusCode < 400
//           ? "3XX"
//           : res.statusCode >= 400 && res.statusCode < 500
//             ? "4XX"
//             : "5XX";

//     const requestSize = Number(req.get("Content-Length") ?? 0);
//     this.common.metrics.ponder_server_request_size.observe(
//       { method, path, status },
//       Number(requestSize),
//     );

//     const responseSize = Number(res.get("Content-Length") ?? 0);
//     this.common.metrics.ponder_server_response_size.observe(
//       { method, path, status },
//       Number(responseSize),
//     );

//     this.common.metrics.ponder_server_response_duration.observe(
//       { method, path, status },
//       responseDuration,
//     );
//   });
//   next();
// });

// this.common.logger.info({
//   service: "server",
//   msg: `Started listening on port ${this.port}`,
// });

// app.post("/metrics", async (_, res) => {
//   try {
//     res.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
//     res.end(await this.common.metrics.getMetrics());
//   } catch (error) {
//     res.status(500).end(error);
//   }
// });

// app.get("/metrics", async (_, res) => {
//   try {
//     res.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
//     res.end(await this.common.metrics.getMetrics());
//   } catch (error) {
//     res.status(500).end(error);
//   }
// });

// // By default, the server will respond as unhealthy until historical index has
// // been processed OR 4.5 minutes have passed since the app was created. This
// // enables zero-downtime deployments on PaaS platforms like Railway and Render.
// // Also see https://github.com/0xOlias/ponder/issues/24
// app.get("/health", (_, res) => {
//   if (this.isHistoricalIndexingComplete) {
//     return res.status(200).send();
//   }

//   const max = this.common.options.maxHealthcheckDuration;
//   const elapsed = Math.floor(process.uptime());

//   if (elapsed > max) {
//     this.common.logger.warn({
//       service: "server",
//       msg: `Historical sync duration has exceeded the max healthcheck duration of ${max} seconds (current: ${elapsed}). Sevice is now responding as healthy and may serve incomplete data.`,
//     });
//     return res.status(200).send();
//   }

//   return res.status(503).send();
// });

await startServer(app);

async function startServer(app) {
  const { DEFAULT_PORT, RESOLVED_PORT } = process.env;

  console.log("in startServer with ", { DEFAULT_PORT, RESOLVED_PORT });

  let server;

  if (RESOLVED_PORT === undefined) {
    // If we don't have a resolved port yet, this is the initial worker.
    let port = DEFAULT_PORT;
    server = await new Promise((resolve, reject) => {
      const server = createServer(app)
        .on("error", (error) => {
          if (error.code === "EADDRINUSE") {
            port += 1;
            setTimeout(() => {
              server.close();
              server.listen(port);
            }, 5);
          } else {
            reject(error);
          }
        })
        .on("listening", () => {
          resolve(server);
        })
        .listen(port);
    });
    process.send("message", { kind: "RESOLVED_PORT", port });
  } else {
    server = await new Promise((resolve, reject) => {
      const server = createServer(app)
        .on("error", (error) => {
          reject(error);
        })
        .on("listening", () => {
          resolve(server);
        })
        .listen(RESOLVED_PORT);
    });
  }

  const terminator = createHttpTerminator({ server });
  process.on("exit", async () => {
    await terminator.terminate();
  });
}
