import { createRequire } from "node:module";
import path from "node:path";
import { defineConfig } from "vitest/config";

// Fixes `Duplicate "graphql" modules cannot be used at the same time` issue
const graphqlPath = createRequire(import.meta.url).resolve("graphql");

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      "@ponder/client": path.resolve(import.meta.dirname, "../client/src"),
      "@ponder/utils": path.resolve(import.meta.dirname, "../utils/src"),
      graphql: graphqlPath,
    },
  },
  test: {
    pool: "threads",
    restoreMocks: true,
  },
});
