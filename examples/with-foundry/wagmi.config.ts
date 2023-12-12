import { defineConfig } from "@wagmi/cli";
import { foundry } from "@wagmi/cli/plugins";

export default defineConfig({
  out: "abis/Counter.ts",
  plugins: [
    foundry({
      project: "contracts",
    }),
  ],
});
