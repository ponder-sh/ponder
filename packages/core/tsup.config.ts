import { defineConfig } from "tsup";

export default defineConfig({
  name: "@ponder/core",
  entry: ["src/index.ts", "src/bin/ponder.ts"],
  outDir: "dist",
  format: ["esm"],
  sourcemap: true,
  dts: true,
  clean: true,
  splitting: true,
});
