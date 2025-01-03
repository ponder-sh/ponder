import http from "node:http";
import type { Common } from "@/internal/common.js";

export const getNextAvailablePort = async ({ common }: { common: Common }) => {
  const server = http.createServer();

  let port = common.options.port;

  return new Promise<number>((resolve, reject) => {
    server.once("error", (error: Error & { code: string }) => {
      if (error.code === "EADDRINUSE") {
        common.logger.warn({
          service: "server",
          msg: `Port ${port} was in use, trying port ${port + 1}`,
        });
        port += 1;
        setTimeout(() => {
          server.close();
          server.listen(port, common.options.hostname);
        }, 5);
      } else {
        reject(error);
      }
    });

    server.once("listening", () => {
      // Port is available
      server.close();
      resolve(port);
    });

    server.listen(port, common.options.hostname);
  });
};
