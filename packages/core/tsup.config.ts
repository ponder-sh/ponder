import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/bin/ponder.ts"],
  bundle: true,
  format: ["cjs", "esm"],
  sourcemap: true,
  dts: true,
  clean: true,
});
