import { providers, utils } from "ethers";
import fs from "fs";

interface RawPonderConfig {
  rpcUrls: { [chainId: number]: string };
  sources: {
    type: string;
    chainId: number;
    abi: string;
    address: string;
  }[];
}

interface PonderConfig {
  providers: { [chainId: number]: providers.JsonRpcProvider };
  sources: {
    type: string;
    chainId: number;
    address: string;
    abi: utils.Interface;
  }[];
}

const parseConfig = (rawConfig: any): PonderConfig => {
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
    const abiString = fs.readFileSync(source.abi).toString();
    // TODO: Validate / throw an error if this fails

    const abi = new utils.Interface(abiString);

    return { ...source, abi: abi };
  });

  const config = {
    ...validatedConfig,
    sources: hydratedSources,
    providers: hydratedProviders,
  };

  return config;
};

export { parseConfig };
export type { PonderConfig };
