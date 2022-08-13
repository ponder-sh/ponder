import { providers, utils } from "ethers";
import fs from "node:fs";

import { toolConfig } from "./config";

enum SourceKind {
  EVM = "evm",
}

interface RawPonderConfig {
  rpcUrls: { [chainId: number]: string };
  sources: {
    name: string;
    kind: SourceKind;
    chainId: number;
    address: string;
    abi: string;
  }[];
}

interface PonderConfig {
  providers: { [chainId: number]: providers.JsonRpcProvider };
  sources: {
    name: string;
    kind: SourceKind;
    chainId: number;
    address: string;
    abiPath: string;
    abi: utils.Interface;
  }[];
}

const getConfig = async () => {
  const { default: rawConfig } = await import(toolConfig.pathToUserConfigFile);

  // TODO: Validate config
  const validatedConfig = rawConfig as RawPonderConfig;

  const hydratedProviders = Object.entries(validatedConfig.rpcUrls).reduce<{
    [chainId: number]: providers.JsonRpcProvider;
  }>((acc, [chainId, rpcUrl]) => {
    acc[Number(chainId)] = new providers.JsonRpcProvider(
      rpcUrl,
      Number(chainId)
    );
    return acc;
  }, {});

  const hydratedSources = validatedConfig.sources.map((source) => {
    // TODO: Validate / throw an error if this ABI parsing nonsense fails
    const abiObject = JSON.parse(fs.readFileSync(source.abi).toString());
    const abiString = abiObject.abi
      ? JSON.stringify(abiObject.abi)
      : JSON.stringify(abiObject);
    const abi = new utils.Interface(abiString);

    return { ...source, abiPath: source.abi, abi: abi };
  });

  const config = {
    ...validatedConfig,
    sources: hydratedSources,
    providers: hydratedProviders,
  };

  return config;
};

export { getConfig, SourceKind };
export type { PonderConfig };
