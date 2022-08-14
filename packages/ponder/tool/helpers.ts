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

const providerCache: { [chainId: number]: providers.JsonRpcProvider } = {};

const getProviderForSource = (
  config: PonderConfig,
  source: PonderConfig["sources"][number]
) => {
  if (providerCache[source.chainId]) {
    return providerCache[source.chainId];
  } else {
    if (config.rpcUrls[source.chainId]) {
      const provider = new providers.JsonRpcProvider(
        config.rpcUrls[source.chainId],
        Number(source.chainId)
      );
      return provider;
    } else {
      throw new Error(`No RPC url found for chain ID: ${source.chainId}`);
    }
  }
};

export { getEntities, getProviderForSource };
