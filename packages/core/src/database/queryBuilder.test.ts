import { setupCommon, setupIsolatedDatabase } from "@/_test/setup.js";
import { NotNullConstraintError } from "@/internal/errors.js";
import { createPool } from "@/utils/pg.js";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";
import { beforeEach, expect, test, vi } from "vitest";
import { SCHEMATA } from "./index.js";
import { createQB } from "./queryBuilder.js";

beforeEach(setupCommon);
beforeEach(setupIsolatedDatabase);

test("QB query", async (context) => {
  if (context.databaseConfig.kind !== "postgres") return;

  const pool = createPool(
    context.databaseConfig.poolConfig,
    context.common.logger,
  );
  const qb = createQB(context.common, drizzle(pool, { casing: "snake_case" }));

  await qb("test1").select().from(SCHEMATA);
  await qb().execute(sql`SELECT * FROM information_schema.schemata`);
});

test("QB transaction", async (context) => {
  if (context.databaseConfig.kind !== "postgres") return;

  const pool = createPool(
    context.databaseConfig.poolConfig,
    context.common.logger,
  );
  const qb = createQB(context.common, drizzle(pool, { casing: "snake_case" }));

  await qb("test1").transaction(async (tx) => {
    await tx("test2").select().from(SCHEMATA);
  });
  await qb("test3").transaction(async (tx) => {
    await tx("test4").execute(sql`SELECT * FROM information_schema.schemata`);
  });
  await qb("test4").transaction(async (tx) => {
    await tx("test5").transaction(async (tx) => {
      await tx("test6").select().from(SCHEMATA);
    });
  });
});

test("QB retries error", async (context) => {
  if (context.databaseConfig.kind !== "postgres") return;

  const pool = createPool(
    context.databaseConfig.poolConfig,
    context.common.logger,
  );
  const qb = createQB(context.common, drizzle(pool, { casing: "snake_case" }));

  const querySpy = vi.spyOn(pool, "query");
  querySpy.mockRejectedValueOnce(new Error("Database connection error"));

  await qb("test1").select().from(SCHEMATA);

  expect(querySpy).toHaveBeenCalledTimes(2);
});

test("QB transaction retries error", async (context) => {
  if (context.databaseConfig.kind !== "postgres") return;

  const pool = createPool(
    context.databaseConfig.poolConfig,
    context.common.logger,
  );
  const connection = await pool.connect();
  const qb = createQB(
    context.common,
    drizzle(connection, { casing: "snake_case" }),
  );

  const querySpy = vi.spyOn(connection, "query");
  querySpy.mockRejectedValueOnce(new Error("Database connection error"));
  let error = true;

  await qb("test1").transaction(async (tx) => {
    if (error) {
      error = false;
      querySpy.mockRejectedValueOnce(new Error("Database connection error"));
    }
    await tx("test2").select().from(SCHEMATA);
  });

  // BEGIN, ROLLBACK, BEGIN, SELECT, COMMIT
  expect(querySpy).toHaveBeenCalledTimes(5);

  connection.release();
});

test("QB parses error", async (context) => {
  if (context.databaseConfig.kind !== "postgres") return;

  const pool = createPool(
    context.databaseConfig.poolConfig,
    context.common.logger,
  );
  const qb = createQB(context.common, drizzle(pool, { casing: "snake_case" }));

  const querySpy = vi.spyOn(pool, "query");
  querySpy.mockRejectedValueOnce(new Error("violates not-null constraint"));

  const error = await qb("test1")
    .select()
    .from(SCHEMATA)
    .catch((error) => error);

  expect(querySpy).toHaveBeenCalledTimes(1);
  expect(error).toBeInstanceOf(NotNullConstraintError);
});

test("QB client", async (context) => {
  if (context.databaseConfig.kind !== "postgres") return;

  const pool = createPool(
    context.databaseConfig.poolConfig,
    context.common.logger,
  );
  const qb = createQB(context.common, drizzle(pool, { casing: "snake_case" }));

  expect(qb.$dialect).toBe("postgres");
  expect(qb.$client).toBeInstanceOf(Pool);

  await qb().transaction(async (tx) => {
    expect(tx.$dialect).toBe("postgres");
    expect(tx.$client).toBeInstanceOf(Client);
  });
});
