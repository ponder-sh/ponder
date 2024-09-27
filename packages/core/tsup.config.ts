import { execa } from "execa";
import { defineConfig } from "tsup";

export default defineConfig({
  name: "@ponder/core",
  entry: ["src/index.ts", "src/bin/ponder.ts", "src/drizzle/db.ts"],
  outDir: "dist",
  format: ["esm", "cjs"],
  sourcemap: true,
  dts: true,
  clean: true,
  splitting: true,
  onSuccess: async () => {
    try {
      await execa("pnpm", ["wagmi", "generate"]);
    } catch {}
  },
});
