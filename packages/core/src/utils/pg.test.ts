import net from "node:net";
import { beforeEach, expect, test } from "vitest";
import { context, setupCommon } from "@/_test/setup.js";
import { withStubbedEnv } from "@/_test/utils.js";
import { createPool, createReadonlyPool, getDatabaseName } from "./pg.js";

beforeEach(setupCommon);

test("getDatabaseName() prioritizes connectionString values", () => {
  const name = getDatabaseName({
    connectionString: "postgres://testhost:5432/pg",
    host: "otherhost",
    port: 5666,
  });
  expect(name).toBe("testhost:5432/pg");
});

test("getDatabaseName() uses env vars", () => {
  withStubbedEnv(
    { PGHOST: "testhost", PGPORT: "5435", PGDATABASE: "testdb" },
    () => {
      const name = getDatabaseName({});
      expect(name).toBe("testhost:5435/testdb");
    },
  );
});

test("getDatabaseName() uses defaults when config/env missing", () => {
  const name = getDatabaseName({});
  expect(name).toBe("localhost:5432/");
});

test("getDatabaseName() prioritizes config over env", () => {
  withStubbedEnv({ PGDATABASE: "otherdatabase" }, () => {
    const name = getDatabaseName({
      database: "test",
      port: 5433,
      host: "testhost",
    });
    expect(name).toBe("testhost:5433/test");
  });
});

test("getDatabaseName() prioritizes connection string over other config values", () => {
  withStubbedEnv({ PGDATABASE: "otherdatabase" }, () => {
    const name = getDatabaseName({
      connectionString: "postgres://testhost:5435/database",
      database: "test",
      port: 5433,
      host: "testhost",
    });
    expect(name).toBe("testhost:5435/database");
  });
});

test("getDatabaseName() mixes defaults, env, and config", () => {
  withStubbedEnv({ PGHOST: "testhost" }, () => {
    const name = getDatabaseName({ database: "test" });
    expect(name).toBe("testhost:5432/test");
  });
});

/**
 * A server that accepts connections like a database proxy whose upstream is unavailable:
 * it either closes each connection cleanly after the startup message ("close"),
 * or never answers it ("hang").
 */
async function createUnavailableServer(mode: "close" | "hang") {
  const sockets = new Set<net.Socket>();
  let connections = 0;
  const server = net.createServer((socket) => {
    connections++;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    if (mode === "close") socket.once("data", () => socket.end());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;

  return {
    connectionString: `postgres://postgres@127.0.0.1:${port}/postgres`,
    connections: () => connections,
    close: () => {
      for (const socket of sockets) socket.destroy();
      server.close();
    },
  };
}

const pools = {
  createPool: (connectionString: string) =>
    createPool(
      { connectionString, max: 1, connectionTimeoutMillis: 200 },
      context.common.logger,
    ),
  createReadonlyPool: (connectionString: string) =>
    createReadonlyPool(
      { connectionString, max: 1, connectionTimeoutMillis: 200 },
      context.common.logger,
      "public",
    ),
};

for (const [name, makePool] of Object.entries(pools)) {
  test(`${name}() releases a client whose connection closes during connect`, async () => {
    const server = await createUnavailableServer("close");
    const pool = makePool(server.connectionString);

    await expect(pool.query("SELECT 1")).rejects.toThrow(
      "Connection terminated unexpectedly",
    );
    expect(pool.totalCount).toBe(0);

    await expect(pool.query("SELECT 1")).rejects.toThrow();
    expect(server.connections()).toBe(2);

    await pool.end();
    server.close();
  });

  test(`${name}() releases a client whose connection times out during connect`, async () => {
    const server = await createUnavailableServer("hang");
    const pool = makePool(server.connectionString);

    await expect(pool.query("SELECT 1")).rejects.toThrow(
      "Connection terminated due to connection timeout",
    );
    expect(pool.totalCount).toBe(0);

    await expect(pool.query("SELECT 1")).rejects.toThrow();
    expect(server.connections()).toBe(2);

    await pool.end();
    server.close();
  });
}
