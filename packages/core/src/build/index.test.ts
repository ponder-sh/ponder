import { beforeEach, expect, test } from "vitest";
import { context, setupCleanup, setupCommon } from "@/_test/setup.js";
import { BuildError } from "@/internal/errors.js";
import { PONDER_SYNC_SCHEMAS } from "@/sync-store/schema.js";
import { createBuild } from "./index.js";

beforeEach(setupCommon);
beforeEach(setupCleanup);

const cliOptions = {
  command: "start",
  config: "",
  root: "",
  logLevel: "silent",
  logFormat: "pretty",
  version: "0.0.0",
} as const;

test("namespaceCompile() rejects a sync schema as the schema", async () => {
  for (const schema of PONDER_SYNC_SCHEMAS) {
    const build = await createBuild({
      common: context.common,
      cliOptions: { ...cliOptions, schema },
    });

    expect(build.namespaceCompile()).toEqual({
      status: "error",
      error: new BuildError(
        `Invalid schema name. "${schema}" is a reserved schema name.`,
      ),
    });
  }
});

test("namespaceCompile() rejects a sync schema as the views schema", async () => {
  for (const viewsSchema of PONDER_SYNC_SCHEMAS) {
    const build = await createBuild({
      common: context.common,
      cliOptions: { ...cliOptions, schema: "public", viewsSchema },
    });

    expect(build.namespaceCompile()).toEqual({
      status: "error",
      error: new BuildError(
        `Invalid views schema name. "${viewsSchema}" is a reserved schema name.`,
      ),
    });
  }
});
