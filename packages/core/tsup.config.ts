import { defineConfig } from "tsup";

export default defineConfig({
  name: "ponder",
  entry: ["src/index.ts", "src/bin/ponder.ts", "src/drizzle/onchain.ts"],
  outDir: "dist",
  format: ["esm"],
  sourcemap: true,
  dts: true,
  clean: true,
  splitting: true,
});
