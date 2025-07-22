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
  const qb = createQB(drizzle(pool, { casing: "snake_case" }), {
    common: context.common,
  });

  await qb.execute(sql`SELECT * FROM information_schema.schemata`);
  const query = qb.select().from(SCHEMATA);
  await qb.wrap({ label: "test" }, (db) => db.select().from(SCHEMATA));
  await query;
});

test("QB transaction", async (context) => {
  if (context.databaseConfig.kind !== "postgres") return;

  const pool = createPool(
    context.databaseConfig.poolConfig,
    context.common.logger,
  );
  const qb = createQB(drizzle(pool, { casing: "snake_case" }), {
    common: context.common,
  });

  await qb.transaction({ label: "test1" }, async (tx) => {
    await tx.wrap({ label: "test2" }, (db) => db.select().from(SCHEMATA));
  });
  await qb.transaction({ label: "test3" }, async (tx) => {
    await tx.execute(sql`SELECT * FROM information_schema.schemata`);
  });
  await qb.transaction({ label: "test4" }, async (tx) => {
    await tx.transaction({ label: "test5" }, async (tx) => {
      await tx.wrap({ label: "test6" }, (db) => db.select().from(SCHEMATA));
    });
  });
});

test("QB wrap retries error", async (context) => {
  if (context.databaseConfig.kind !== "postgres") return;

  const pool = createPool(
    context.databaseConfig.poolConfig,
    context.common.logger,
  );
  const qb = createQB(drizzle(pool, { casing: "snake_case" }), {
    common: context.common,
  });

  const querySpy = vi.spyOn(pool, "query");
  querySpy.mockRejectedValueOnce(new Error("Database connection error"));

  await qb.wrap({ label: "test1" }, (db) => db.select().from(SCHEMATA));

  expect(querySpy).toHaveBeenCalledTimes(2);
});

test("QB transaction retries error", async (context) => {
  if (context.databaseConfig.kind !== "postgres") return;

  const pool = createPool(
    context.databaseConfig.poolConfig,
    context.common.logger,
  );
  const connection = await pool.connect();
  const qb = createQB(drizzle(connection, { casing: "snake_case" }), {
    common: context.common,
  });

  const querySpy = vi.spyOn(connection, "query");
  querySpy.mockRejectedValueOnce(new Error("Database connection error"));
  let error = true;

  await qb.transaction({ label: "test1" }, async (tx) => {
    if (error) {
      error = false;
      querySpy.mockRejectedValueOnce(new Error("Database connection error"));
    }
    await tx.wrap({ label: "test2" }, (db) => db.select().from(SCHEMATA));
  });

  // BEGIN, BEGIN, SELECT, ROLLBACK, BEGIN, SELECT, COMMIT
  expect(querySpy).toHaveBeenCalledTimes(7);

  connection.release();
});

test("QB parses error", async (context) => {
  if (context.databaseConfig.kind !== "postgres") return;

  const pool = createPool(
    context.databaseConfig.poolConfig,
    context.common.logger,
  );
  const qb = createQB(drizzle(pool, { casing: "snake_case" }), {
    common: context.common,
  });

  const querySpy = vi.spyOn(pool, "query");
  querySpy.mockRejectedValueOnce(new Error("violates not-null constraint"));

  const error = await qb
    .wrap({ label: "test1" }, (db) => db.select().from(SCHEMATA))
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
  const qb = createQB(drizzle(pool, { casing: "snake_case" }), {
    common: context.common,
  });

  expect(qb.$dialect).toBe("postgres");
  expect(qb.$client).toBeInstanceOf(Pool);

  await qb.transaction(async (tx) => {
    expect(tx.$dialect).toBe("postgres");
    expect(tx.$client).toBeInstanceOf(Client);
  });
});
