import { setupCommon } from "@/_test/setup.js";
import { withStubbedEnv } from "@/_test/utils.js";
import { beforeEach, expect, test } from "vitest";
import { getDatabaseName } from "./pg.js";

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
