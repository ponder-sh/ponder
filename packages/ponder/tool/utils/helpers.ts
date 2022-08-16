import { createHash } from "crypto";
import { providers } from "ethers";
import { GraphQLObjectType, GraphQLSchema, Kind } from "graphql";
import { readFile } from "node:fs/promises";

import { PonderConfig } from "../readUserConfig";

// Find all types in the schema that are marked with the @entity directive.
const getEntities = (schema: GraphQLSchema) => {
  const entities = Object.values(schema.getTypeMap())
    .filter((type): type is GraphQLObjectType => {
      return type.astNode?.kind === Kind.OBJECT_TYPE_DEFINITION;
    })
    .filter((type) => {
      const entityDirective = type.astNode?.directives?.find(
        (directive) => directive.name.value === "entity"
      );

      return !!entityDirective;
    });

  return entities;
};

const providerCache: {
  [chainId: number]: providers.JsonRpcProvider | undefined;
} = {};

const getProviderForChainId = (config: PonderConfig, chainId: number) => {
  const cachedProvider = providerCache[chainId];
  if (cachedProvider) {
    return cachedProvider;
  }

  if (config.rpcUrls[chainId]) {
    const provider = new providers.JsonRpcProvider(
      config.rpcUrls[chainId],
      Number(chainId)
    );
    providerCache[chainId] = provider;
    return provider;
  } else {
    throw new Error(`No RPC url found for chain ID: ${chainId}`);
  }
};

const startBenchmark = () => process.hrtime();
const endBenchmark = (hrt: [number, number]) => {
  const diffHrt = process.hrtime(hrt);
  const diffMilliseconds = Math.round(diffHrt[0] * 1000 + diffHrt[1] / 1000000);
  const diffString =
    diffMilliseconds >= 1000
      ? `${Math.round((diffMilliseconds / 1000) * 10) / 10}s`
      : `${diffMilliseconds}ms`;

  return diffString;
};

const latestFileHash: { [key: string]: string | undefined } = {};

const fileIsChanged = async (filePath: string) => {
  const content = await readFile(filePath, "utf-8");
  const hash = createHash("md5").update(content).digest("hex");

  const prevHash = latestFileHash[filePath];
  latestFileHash[filePath] = hash;
  if (prevHash) {
    return prevHash !== hash;
  } else {
    return false;
  }
};

export {
  endBenchmark,
  fileIsChanged,
  getEntities,
  getProviderForChainId,
  startBenchmark,
};
