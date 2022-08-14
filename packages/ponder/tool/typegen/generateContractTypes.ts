import { runTypeChain } from "typechain";

import type { PonderConfig } from "../readUserConfig";

const generateContractTypes = async (config: PonderConfig) => {
  const cwd = process.cwd();

  const abiFilePaths = config.sources.map((source) => source.abi);

  // TODO: don't parse all the ABI files again, use the Contract.Interface we already have?
  // TODO: don't generate factory files, we don't need them?
  await runTypeChain({
    cwd,
    filesToProcess: abiFilePaths,
    allFiles: abiFilePaths,
    outDir: "generated/typechain",
    target: "ethers-v5",
  });

  console.log(`Regenerated contract types`);
};

export { generateContractTypes };
