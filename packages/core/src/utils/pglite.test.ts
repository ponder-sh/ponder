import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { NonRetryableUserError } from "@/internal/errors.js";
import { createPglite } from "./pglite.js";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), "ponder-pglite-"));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

test("createPglite() throws for a data directory from a different Postgres version", () => {
  writeFileSync(path.join(dataDir, "PG_VERSION"), "16\n");

  expect(() => createPglite({ dataDir })).toThrow(NonRetryableUserError);
  expect(() => createPglite({ dataDir })).toThrow(
    "uses Postgres 16, but this version of Ponder uses Postgres 18",
  );
});

test("createPglite() opens a new data directory", async () => {
  const instance = createPglite({ dataDir: path.join(dataDir, "pglite") });

  const result = await instance.query<{ server_version: string }>(
    "SHOW server_version",
  );
  expect(result.rows[0]!.server_version.startsWith("18.")).toBe(true);

  await instance.close();
});
