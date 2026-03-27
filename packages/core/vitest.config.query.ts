import { createRequire } from "node:module";
import path from "node:path";
import { defineConfig } from "vitest/config";

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
    // No globalSetup — these tests don't need Anvil
    setupFiles: ["src/_test/setup.ts"],
    testTimeout: 60000,
    include: ["src/sync-historical/query.test.ts"],
  },
});
