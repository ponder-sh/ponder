import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@ponder/common": path.resolve(__dirname, "../common/src"),
    },
  },
  test: {
    globalSetup: ["src/_test/globalSetup.ts"],
  },
});
