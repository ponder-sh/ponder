import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Common } from "@/internal/common.js";
import { createLogger } from "@/internal/logger.js";
import { MetricsService } from "@/internal/metrics.js";
import { buildOptions } from "@/internal/options.js";
import { createShutdown } from "@/internal/shutdown.js";
import { createTelemetry } from "@/internal/telemetry.js";
import { expect, test } from "vitest";
import { createBuild } from "./index.js";

const write = (file: string, contents: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
};

test("executeIndexingFunctions() ignores colocated test files", async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "ponder-build-"));
  let common: Common | undefined;

  try {
    write(
      path.join(rootDir, "src", "index.ts"),
      'import { ponder } from "ponder:registry";\nponder.on("A:Event", () => {});\n',
    );
    write(
      path.join(rootDir, "src", "business.test.ts"),
      'throw new Error("colocated test file was executed");\n',
    );
    write(
      path.join(rootDir, "src", "business.spec.ts"),
      'throw new Error("colocated spec file was executed");\n',
    );
    write(
      path.join(rootDir, "src", "business.test-d.ts"),
      'throw new Error("colocated type test file was executed");\n',
    );
    write(
      path.join(rootDir, "src", "__tests__", "business.ts"),
      'throw new Error("__tests__ file was executed");\n',
    );
    write(path.join(rootDir, "ponder.config.ts"), "export default {};\n");
    write(path.join(rootDir, "ponder.schema.ts"), "\n");

    const cliOptions = {
      command: "start",
      root: rootDir,
      config: "ponder.config.ts",
      logLevel: "silent",
      logFormat: "pretty",
      version: "0.0.0",
    } as const;
    const options = {
      ...buildOptions({ cliOptions }),
      telemetryDisabled: true,
    };
    const logger = createLogger({ level: "silent" });
    const shutdown = createShutdown();
    common = {
      options,
      logger,
      metrics: new MetricsService(),
      telemetry: createTelemetry({ options, logger, shutdown }),
      shutdown,
      apiShutdown: shutdown,
      buildShutdown: shutdown,
    };

    const build = await createBuild({ common, cliOptions });
    const result = await build.executeIndexingFunctions();

    if (result.status === "error") throw result.error;

    expect(result.result.indexingFunctions.map((fn) => fn.name)).toEqual([
      "A:Event",
    ]);
  } finally {
    await common?.buildShutdown.kill();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
