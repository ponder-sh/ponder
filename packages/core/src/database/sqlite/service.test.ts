import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, test } from "vitest";
import { SqliteDatabaseService } from "./service.js";

const tempDir = path.join(os.tmpdir(), randomUUID());

beforeEach(() => {
  mkdirSync(tempDir, { recursive: true });
  return () => rmSync(tempDir, { recursive: true, force: true });
});

test("works", async (context) => {
  const database = new SqliteDatabaseService({
    common: context.common,
    directory: tempDir,
  });

  await database.setup();
});
