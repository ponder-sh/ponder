import os from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@ponder/client": path.resolve(__dirname, "../client/src"),
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
  },
});
