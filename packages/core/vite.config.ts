import os from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@ponder/common": path.resolve(__dirname, "../common/src"),
      "@ponder/utils": path.resolve(__dirname, "../utils/src"),
    },
  },
  test: {
    globalSetup: ["src/_test/globalSetup.ts"],
    setupFiles: ["src/_test/setup.ts"],
    poolOptions: {
      threads: {
        maxThreads: 4,
        minThreads: 1,
      },
    },
    sequence: { hooks: "stack" },
    testTimeout: os.platform() === "win32" ? 30_000 : 10_000,
    coverage: {
      enabled: true,
      provider: "v8",
      reporter: ["text", "json", "html"],
      reportsDirectory: "coverage",
    },
    server: {
      deps: {
        // needed so that graphql is resolved as a
        // CJS module and not loaded 2x (erring)
        fallbackCJS: true,
      },
    },
  },
});
