import { defineConfig } from "@wagmi/cli";
import { foundry } from "@wagmi/cli/plugins";

export default defineConfig({
  out: "abis/CounterAbi.ts",
  plugins: [
    foundry({
      project: "foundry",
      include: ["Counter.sol/**"],
    }),
  ],
});
