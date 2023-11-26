import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/ponder.ts", "src/subgraph.ts"],
  bundle: true,
  format: ["esm"],
  sourcemap: false,
  dts: false,
  clean: true,
});
