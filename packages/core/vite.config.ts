import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    globalSetup: ["src/_test/globalSetup.ts"],
    setupFiles: ["src/_test/setup.ts"],
    include: ["src/**/*.test.ts"],
    exclude: [
      "src/_test/art-gobblers/**",
      "src/_test/ens/*",
      "src/sync-store/*",
    ],
  },
});
