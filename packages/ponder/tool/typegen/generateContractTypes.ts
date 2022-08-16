import { runTypeChain } from "typechain";

import { logger } from "../logger";
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

  logger.info(`\x1b[36m${"GENERATED CONTRACT TYPES"}\x1b[0m`); // magenta
};

export { generateContractTypes };
