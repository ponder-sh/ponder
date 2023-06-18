import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/bench.ts"],
  bundle: true,
  format: ["esm"],
  sourcemap: false,
  dts: false,
  clean: true,
});
