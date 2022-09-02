import { createHash } from "crypto";
import { providers } from "ethers";
import { readFile } from "node:fs/promises";

import type { PonderConfig } from "@/types";

export const groupBy = <T>(array: T[], fn: (item: T) => string | number) => {
  return array.reduce<{ [k: string | number]: T[] }>((acc, item) => {
    const key = fn(item);
    (acc[key] = acc[key] || []).push(item);
    return acc;
  }, {});
};

const providerCache: {
  [chainId: number]: providers.StaticJsonRpcProvider | undefined;
} = {};

export const getProviderForChainId = (
  config: PonderConfig,
  chainId: number
) => {
  const cachedProvider = providerCache[chainId];
  if (cachedProvider) {
    return cachedProvider;
  }

  const sourcesByChainId = groupBy(config.sources, (source) => source.chainId);

  const sources = sourcesByChainId[chainId];
  const firstSourceRpcUrl = sources[0].rpcUrl;

  if (!sources.every((source) => source.rpcUrl === firstSourceRpcUrl)) {
    throw new Error(`Cannot use different RPC urls for the same chain ID`);
  }

  const provider = new providers.StaticJsonRpcProvider(
    firstSourceRpcUrl,
    Number(chainId)
  );
  providerCache[chainId] = provider;
  return provider;
};

export const startBenchmark = () => process.hrtime();
export const endBenchmark = (hrt: [number, number]) => {
  const diffHrt = process.hrtime(hrt);
  const diffMilliseconds = Math.round(diffHrt[0] * 1000 + diffHrt[1] / 1000000);
  const diffString =
    diffMilliseconds >= 1000
      ? `${Math.round((diffMilliseconds / 1000) * 10) / 10}s`
      : `${diffMilliseconds}ms`;

  return diffString;
};

const latestFileHash: { [key: string]: string | undefined } = {};

export const fileIsChanged = async (filePath: string) => {
  // TODO: I think this throws if the file being watched gets deleted while
  // the development server is running. Should handle this case gracefully.
  const content = await readFile(filePath, "utf-8");
  const hash = createHash("md5").update(content).digest("hex");

  const prevHash = latestFileHash[filePath];
  latestFileHash[filePath] = hash;
  if (!prevHash) {
    // If there is no previous hash, this file is being changed for the first time.
    return true;
  } else {
    // If there is a previous hash, check if the content hash has changed.
    return prevHash !== hash;
  }
};
