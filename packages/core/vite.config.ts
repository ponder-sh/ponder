import path from "node:path";
import url from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = url.fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // need this for src/_test/ens and src/_test/art-gobblers
      "@ponder/core": path.resolve(__dirname, "dist/index.js"),
    },
  },
  test: {
    env: {
      NODE_ENV: "test",
    },
    globalSetup: ["src/_test/globalSetup.ts"],
    setupFiles: ["src/_test/setup.ts"],
  },
});
