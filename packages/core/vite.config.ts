import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    globalSetup: ["test/utils/globalSetup.ts"],
    setupFiles: ["test/utils/setup.ts"],
  },
});
