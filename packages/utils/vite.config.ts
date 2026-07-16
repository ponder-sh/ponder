import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["src/_test/globalSetup.ts"],
  },
});
