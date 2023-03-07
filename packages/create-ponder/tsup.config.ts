import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/bin/create-ponder.ts"],
  bundle: true,
  format: ["cjs", "esm"],
  sourcemap: true,
  dts: true,
  clean: true,
});
