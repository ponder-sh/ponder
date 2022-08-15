import { providers } from "ethers";
import { GraphQLObjectType, GraphQLSchema, Kind } from "graphql";

import { PonderConfig } from "./readUserConfig";

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

export { getEntities, getProviderForChainId };
