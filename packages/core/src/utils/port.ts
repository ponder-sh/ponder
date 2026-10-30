import http from "node:http";
import { Effect } from "effect";

/**
 * Listen on `port` and close the server right away.
 *
 * @returns `false` if the port is in use.
 */
const isPortAvailable = (port: number, hostname: string | undefined) =>
  Effect.callback<boolean, Error>((resume) => {
    const server = http.createServer();

    server.once("error", (error: Error & { code: string }) => {
      server.close();
      if (error.code === "EADDRINUSE") {
        resume(Effect.succeed(false));
      } else {
        resume(Effect.fail(error));
      }
    });

    server.once("listening", () => {
      server.close();
      resume(Effect.succeed(true));
    });

    server.listen(port, hostname);

    return Effect.sync(() => server.close());
  });

/**
 * Find the first available port, starting at `port`.
 */
export const getNextAvailablePort = ({
  port,
  hostname,
}: {
  port: number;
  hostname: string | undefined;
}): Effect.Effect<number, Error> =>
  Effect.gen(function* () {
    while ((yield* isPortAvailable(port, hostname)) === false) {
      yield* Effect.logWarning({ msg: "Port in use", port });
      port += 1;
      yield* Effect.sleep(5);
    }

    return port;
  });
