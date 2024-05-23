import { defineConfig } from "tsup";

export default defineConfig({
  name: "@ponder/utils",
  entry: {
    index: "src/index.ts",
    "merge-abis": "src/mergeAbis.ts",
    "rate-limit": "src/rateLimit.ts",
    "load-balance": "src/loadBalance.ts",
    "retry-helper": "src/getLogsRetryHelper.ts",
  },
  outDir: "dist",
  format: ["esm", "cjs"],
  sourcemap: true,
  dts: true,
  clean: true,
  splitting: true,
});
