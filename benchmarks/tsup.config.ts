import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/ponder.ts"],
  bundle: true,
  format: ["esm"],
  sourcemap: false,
  dts: false,
  clean: true,
});
