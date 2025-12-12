import { createRequire } from "node:module";
import path from "node:path";
import { defineConfig } from "vitest/config";

// Fixes `Duplicate "graphql" modules cannot be used at the same time` issue
const graphqlPath = createRequire(import.meta.url).resolve("graphql");

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@ponder/client": path.resolve(__dirname, "../client/src"),
      "@ponder/utils": path.resolve(__dirname, "../utils/src"),
      graphql: graphqlPath,
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
    testTimeout: 15000,
  },
});
