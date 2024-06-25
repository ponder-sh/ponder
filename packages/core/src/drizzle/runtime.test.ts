import {
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { SqliteDatabaseService } from "@/database/sqlite/service.js";
import type { HistoricalStore } from "@/indexing-store/store.js";
import { createSchema } from "@/schema/schema.js";
import { beforeEach, expect, test } from "vitest";
import type { DrizzleDb } from "./db.js";
import { convertToDrizzleTable, createDrizzleDb } from "./runtime.js";

beforeEach(setupCommon);
beforeEach(setupIsolatedDatabase);

test("runtime select", async (context) => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.string(),
    }),
  }));

  const { database, cleanup, indexingStore } = await setupDatabaseServices(
    context,
    {
      schema,
    },
  );

  let db: DrizzleDb;

  if (database instanceof SqliteDatabaseService) {
    db = createDrizzleDb({
      kind: "sqlite",
      database: database.userDatabase,
    }) as any;
  }

  await indexingStore.create({ tableName: "table", id: "kyle" });

  await (indexingStore as HistoricalStore).flush({ isFullFlush: true });

  const rows = await db!
    .select()
    .from(convertToDrizzleTable("table", schema.table.table, "sqlite"));

  expect(rows).toHaveLength(1);

  expect(rows[0]).toMatchObject({ id: "kyle" });

  await cleanup();
});
