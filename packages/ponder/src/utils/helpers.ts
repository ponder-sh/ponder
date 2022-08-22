import { createHash } from "crypto";
import { providers } from "ethers";
import {
  GraphQLEnumType,
  GraphQLObjectType,
  GraphQLSchema,
  Kind,
} from "graphql";
import { readFile } from "node:fs/promises";

import type { PonderConfig } from "../readUserConfig";

const groupBy = <T>(array: T[], fn: (item: T) => string | number) => {
  return array.reduce<{ [k: string | number]: T[] }>((acc, item) => {
    const key = fn(item);
    (acc[key] = acc[key] || []).push(item);
    return acc;
  }, {});
};

// Find all types in the schema that were created by the user.
const getUserDefinedTypes = (schema: GraphQLSchema) => {
  // This assumes that any type that has an AST node that is NOT
  // a scalar type definition will be a user-defined type.
  const userDefinedTypeArray = Object.values(schema.getTypeMap()).filter(
    (type): type is GraphQLObjectType | GraphQLEnumType =>
      !!type.astNode && type.astNode.kind !== Kind.SCALAR_TYPE_DEFINITION
  );

  // Add all user-defined types to a map so we can look them up later.
  const userDefinedTypes: {
    [key: string]: GraphQLObjectType | GraphQLEnumType | undefined;
  } = {};
  for (const userDefinedType of userDefinedTypeArray) {
    userDefinedTypes[userDefinedType.name] = userDefinedType;
  }

  return userDefinedTypes;
};

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

  const sourcesByChainId = groupBy(config.sources, (source) => source.chainId);

  const sources = sourcesByChainId[chainId];
  const firstSourceRpcUrl = sources[0].rpcUrl;

  if (!sources.every((source) => source.rpcUrl === firstSourceRpcUrl)) {
    throw new Error(`Cannot use different RPC urls for the same chain ID`);
  }

  const provider = new providers.JsonRpcProvider(
    firstSourceRpcUrl,
    Number(chainId)
  );
  providerCache[chainId] = provider;
  return provider;
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

export {
  endBenchmark,
  fileIsChanged,
  getEntities,
  getProviderForChainId,
  getUserDefinedTypes,
  startBenchmark,
};
