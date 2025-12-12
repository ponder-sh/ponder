import path from "node:path";
import { withStubbedEnv } from "@/_test/utils.js";
import type { Options } from "@/internal/options.js";
import { expect, test } from "vitest";
import { createConfig } from "../config/index.js";
import { buildPre } from "./pre.js";

const options = {
  ponderDir: ".ponder",
  rootDir: "rootDir",
} as const satisfies Pick<Options, "rootDir" | "ponderDir">;

test("buildPre() database uses pglite by default", () => {
  const config = createConfig({
    chains: { mainnet: { id: 1, rpc: "https://rpc.com" } },
    contracts: { a: { chain: "mainnet", abi: [] } },
  });

  withStubbedEnv(
    { DATABASE_URL: undefined, PRIVATE_DATABASE_URL: undefined },
    () => {
      const { databaseConfig } = buildPre({
        config,
        options,
      });
      expect(databaseConfig).toMatchObject({
        kind: "pglite",
        options: {
          dataDir: expect.stringContaining(path.join(".ponder", "pglite")),
        },
      });
    },
  );

  withStubbedEnv({ DATABASE_URL: "", PRIVATE_DATABASE_URL: "" }, () => {
    const { databaseConfig: databaseConfig2 } = buildPre({
      config,
      options,
    });
    expect(databaseConfig2).toMatchObject({
      kind: "pglite",
      options: {
        dataDir: expect.stringContaining(path.join(".ponder", "pglite")),
      },
    });
  });
});

test("buildPre() database respects custom pglite path", async () => {
  const config = createConfig({
    database: { kind: "pglite", directory: "custom-pglite/directory" },
    chains: { mainnet: { id: 1, rpc: "https://rpc.com" } },
    contracts: { a: { chain: "mainnet", abi: [] } },
  });

  const { databaseConfig } = buildPre({ config, options });

  expect(databaseConfig).toMatchObject({
    kind: "pglite",
    options: {
      dataDir: expect.stringContaining(path.join("custom-pglite", "directory")),
    },
  });
});

test("buildPre() database uses pglite if specified even if DATABASE_URL env var present", async () => {
  const config = createConfig({
    database: { kind: "pglite" },
    chains: { mainnet: { id: 1, rpc: "https://rpc.com" } },
    contracts: { a: { chain: "mainnet", abi: [] } },
  });

  withStubbedEnv(
    { DATABASE_URL: "postgres://username@localhost:5432/database" },
    () => {
      const { databaseConfig } = buildPre({ config, options });
      expect(databaseConfig).toMatchObject({
        kind: "pglite",
        options: {
          dataDir: expect.stringContaining(path.join(".ponder", "pglite")),
        },
      });
    },
  );
});

test("buildPre() database uses postgres if DATABASE_URL env var present", async () => {
  const config = createConfig({
    chains: { mainnet: { id: 1, rpc: "https://rpc.com" } },
    contracts: { a: { chain: "mainnet", abi: [] } },
  });

  withStubbedEnv(
    { DATABASE_URL: "postgres://username@localhost:5432/database" },
    () => {
      const { databaseConfig } = buildPre({ config, options });
      expect(databaseConfig).toMatchObject({
        kind: "postgres",
        poolConfig: {
          connectionString: "postgres://username@localhost:5432/database",
        },
      });
    },
  );
});

test("buildPre() database uses postgres if DATABASE_PRIVATE_URL env var present", async () => {
  const config = createConfig({
    chains: { mainnet: { id: 1, rpc: "https://rpc.com" } },
    contracts: { a: { chain: "mainnet", abi: [] } },
  });

  withStubbedEnv(
    {
      DATABASE_URL: "postgres://username@localhost:5432/database",
      DATABASE_PRIVATE_URL:
        "postgres://username@localhost:5432/better_database",
    },
    () => {
      const { databaseConfig } = buildPre({ config, options });
      expect(databaseConfig).toMatchObject({
        kind: "postgres",
        poolConfig: {
          connectionString:
            "postgres://username@localhost:5432/better_database",
        },
      });
    },
  );
});

test("buildPre() throws for postgres database with no connection string", async () => {
  const config = createConfig({
    database: { kind: "postgres" },
    chains: { mainnet: { id: 1, rpc: "https://rpc.com" } },
    contracts: { a: { chain: "mainnet", abi: [] } },
  });

  withStubbedEnv(
    { DATABASE_URL: undefined, PRIVATE_DATABASE_URL: undefined },
    () => {
      expect(() => buildPre({ config, options })).toThrow(
        "Invalid database configuration: 'kind' is set to 'postgres' but no connection string was provided.",
      );
    },
  );
});

test("buildPre() database with postgres uses pool config", async () => {
  const config = createConfig({
    database: {
      kind: "postgres",
      connectionString: "postgres://username@localhost:5432/database",
      poolConfig: {
        max: 100,
        ssl: {
          ca: "ca",
          cert: "cert",
          key: "key",
        },
        idle_in_transaction_session_timeout: 10,
        keepAlive: true,
      },
    },
    chains: { mainnet: { id: 1, rpc: "https://rpc.com" } },
    contracts: { a: { chain: "mainnet", abi: [] } },
  });

  const { databaseConfig } = buildPre({ config, options });

  expect(databaseConfig).toStrictEqual({
    kind: "postgres",
    poolConfig: {
      connectionString: "postgres://username@localhost:5432/database",
      max: 100,
      ssl: {
        ca: "ca",
        cert: "cert",
        key: "key",
      },
      idle_in_transaction_session_timeout: 10,
      keepAlive: true,
    },
  });
});
