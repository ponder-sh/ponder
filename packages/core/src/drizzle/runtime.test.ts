import {
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import type { DatabaseService } from "@/database/service.js";
import { SqliteDatabaseService } from "@/database/sqlite/service.js";
import type { HistoricalStore } from "@/indexing-store/store.js";
import { createSchema } from "@/schema/schema.js";
import { beforeEach, expect, test } from "vitest";
import { convertToDrizzleTable, createDrizzleDb } from "./runtime.js";

beforeEach(setupCommon);
beforeEach(setupIsolatedDatabase);

const createDb = (database: DatabaseService) => {
  if (database instanceof SqliteDatabaseService) {
    return createDrizzleDb({
      kind: "sqlite",
      database: database.userDatabase,
    }) as any;
  } else {
    return createDrizzleDb({
      kind: "postgres",
      pool: database.readonlyPool,
    }) as any;
  }
};

test("runtime select", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.string(),
    }),
  }));

  const { database, cleanup, indexingStore } = await setupDatabaseServices(
    context,
    { schema },
  );

  const db = createDb(database);

  await indexingStore.create({ tableName: "table", id: "kyle" });
  await (indexingStore as HistoricalStore).flush({ isFullFlush: true });

  const rows = await db
    .select()
    .from(convertToDrizzleTable("table", schema.table.table, "sqlite"));

  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ id: "kyle" });

  await cleanup();
});

test("runtime hex", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.hex(),
    }),
  }));

  const { database, cleanup, indexingStore } = await setupDatabaseServices(
    context,
    { schema },
  );

  const db = createDb(database);

  await indexingStore.create({ tableName: "table", id: "0x1" });
  await (indexingStore as HistoricalStore).flush({ isFullFlush: true });

  const rows = await db
    .select()
    .from(convertToDrizzleTable("table", schema.table.table, "postgres"));

  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ id: "0x01" });

  await cleanup();
});

test("runtime bigint", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.bigint(),
    }),
  }));

  const { database, cleanup, indexingStore } = await setupDatabaseServices(
    context,
    { schema },
  );

  const db = createDb(database);

  await indexingStore.create({ tableName: "table", id: 1n });
  await (indexingStore as HistoricalStore).flush({ isFullFlush: true });

  const rows = await db
    .select()
    .from(convertToDrizzleTable("table", schema.table.table, "sqlite"));

  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ id: 1n });

  await cleanup();
});
