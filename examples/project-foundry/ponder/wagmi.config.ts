import { defineConfig } from "@wagmi/cli";
import { foundry } from "@wagmi/cli/plugins";

export default defineConfig({
  out: "codegen.ts",
  contracts: [],
  plugins: [
    foundry({
      project: "../foundry/",
      include: ["Counter.sol/**"],
    }),
  ],
});
