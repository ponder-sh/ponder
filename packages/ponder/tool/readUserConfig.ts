import { utils } from "ethers";
import { readFile } from "node:fs/promises";

import { toolConfig } from "./config";

const { userConfigFile } = toolConfig;

enum SourceKind {
  EVM = "evm",
}

interface PonderUserConfig {
  rpcUrls: { [chainId: number]: string | undefined };
  sources: {
    name: string;
    kind: SourceKind;
    chainId: number;
    address: string;
    abi: string;
  }[];
}

interface PonderConfig {
  rpcUrls: { [chainId: number]: string | undefined };
  sources: {
    name: string;
    kind: SourceKind;
    chainId: number;
    address: string;
    abi: string;
    abiInterface: utils.Interface;
  }[];
}

const readUserConfig = async () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const userConfig = require(userConfigFile);

  // Remove the ponder.config.js module from the require cache,
  // because we are loading it several times in the same process,
  // and we need the latest version each time.
  // https://ar.al/2021/02/22/cache-busting-in-node.js-dynamic-esm-imports/
  delete require.cache[require.resolve(userConfigFile)];

  // console.log("found userConfig:", { required });

  // TODO: Validate config
  const validatedUserConfig = userConfig as PonderUserConfig;

  // Parse ABI files and add interfaces to the config object.
  const newSources = await Promise.all(
    validatedUserConfig.sources.map(async (source) => {
      const abiString = await readFile(source.abi, "utf-8");
      const abiObject = JSON.parse(abiString).abi;
      return { ...source, abiInterface: new utils.Interface(abiObject) };
    })
  );

  const config: PonderConfig = { ...validatedUserConfig, sources: newSources };

  return config;
};

export { readUserConfig, SourceKind };
export type { PonderConfig, PonderUserConfig };
