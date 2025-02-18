import path from "node:path";
import type { Options } from "@/internal/options.js";
import { http } from "viem";
import { expect, test, vi } from "vitest";
import { createConfig } from "../config/index.js";
import { buildPre } from "./pre.js";

const options = {
  ponderDir: ".ponder",
  rootDir: "rootDir",
} as const satisfies Pick<Options, "rootDir" | "ponderDir">;

test("buildPre() database uses pglite by default", () => {
  const config = createConfig({
    networks: { mainnet: { chainId: 1, transport: http() } },
    contracts: { a: { network: "mainnet", abi: [] } },
  });

  const prev = process.env.DATABASE_URL;
  // biome-ignore lint/performance/noDelete: Required to test default behavior.
  delete process.env.DATABASE_URL;

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

  process.env.DATABASE_URL = prev;
});

test("buildPre() database respects custom pglite path", async () => {
  const config = createConfig({
    database: { kind: "pglite", directory: "custom-pglite/directory" },
    networks: { mainnet: { chainId: 1, transport: http() } },
    contracts: { a: { network: "mainnet", abi: [] } },
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
    networks: { mainnet: { chainId: 1, transport: http() } },
    contracts: { a: { network: "mainnet", abi: [] } },
  });

  vi.stubEnv("DATABASE_URL", "postgres://username@localhost:5432/database");

  const { databaseConfig } = buildPre({ config, options });
  expect(databaseConfig).toMatchObject({
    kind: "pglite",
    options: {
      dataDir: expect.stringContaining(path.join(".ponder", "pglite")),
    },
  });

  vi.unstubAllEnvs();
});

test("buildPre() database uses postgres if DATABASE_URL env var present", async () => {
  const config = createConfig({
    networks: { mainnet: { chainId: 1, transport: http() } },
    contracts: { a: { network: "mainnet", abi: [] } },
  });

  vi.stubEnv("DATABASE_URL", "postgres://username@localhost:5432/database");

  const { databaseConfig } = buildPre({ config, options });
  expect(databaseConfig).toMatchObject({
    kind: "postgres",
    poolConfig: {
      connectionString: "postgres://username@localhost:5432/database",
    },
  });

  vi.unstubAllEnvs();
});

test("buildPre() database uses postgres if DATABASE_PRIVATE_URL env var present", async () => {
  const config = createConfig({
    networks: { mainnet: { chainId: 1, transport: http() } },
    contracts: { a: { network: "mainnet", abi: [] } },
  });

  vi.stubEnv("DATABASE_URL", "postgres://username@localhost:5432/database");
  vi.stubEnv(
    "DATABASE_PRIVATE_URL",
    "postgres://username@localhost:5432/better_database",
  );

  const { databaseConfig } = buildPre({ config, options });
  expect(databaseConfig).toMatchObject({
    kind: "postgres",
    poolConfig: {
      connectionString: "postgres://username@localhost:5432/better_database",
    },
  });

  vi.unstubAllEnvs();
});

test("buildPre() throws for postgres database with no connection string", async () => {
  const config = createConfig({
    database: { kind: "postgres" },
    networks: { mainnet: { chainId: 1, transport: http() } },
    contracts: { a: { network: "mainnet", abi: [] } },
  });

  const prev = process.env.DATABASE_URL;
  // biome-ignore lint/performance/noDelete: Required to test default behavior.
  delete process.env.DATABASE_URL;

  expect(() => buildPre({ config, options })).toThrow(
    "Invalid database configuration: 'kind' is set to 'postgres' but no connection string was provided.",
  );

  process.env.DATABASE_URL = prev;
});

test("buildPre() database with postgres uses pool config", async () => {
  const config = createConfig({
    database: {
      kind: "postgres",
      connectionString: "postgres://username@localhost:5432/database",
      poolConfig: { max: 100 },
    },
    networks: { mainnet: { chainId: 1, transport: http() } },
    contracts: { a: { network: "mainnet", abi: [] } },
  });

  const { databaseConfig } = buildPre({ config, options });
  expect(databaseConfig).toMatchObject({
    kind: "postgres",
    poolConfig: {
      connectionString: "postgres://username@localhost:5432/database",
      max: 100,
    },
  });
});
