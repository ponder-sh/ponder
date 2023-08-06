import {
  type GraphQLFieldConfig,
  type GraphQLFieldResolver,
  GraphQLInt,
  GraphQLNonNull,
  GraphQLObjectType,
} from "graphql";

import type { Entity } from "@/schema/types";

import type { Context, Source } from "./schema";

type SingularArgs = {
  id?: string;
  blockNumber?: number;
};
type SingularResolver = GraphQLFieldResolver<Source, Context, SingularArgs>;

const buildSingularField = ({
  entity,
  entityGqlType,
}: {
  entity: Entity;
  entityGqlType: GraphQLObjectType<Source, Context>;
}): GraphQLFieldConfig<Source, Context> => {
  const resolver: SingularResolver = async (_, args, context) => {
    const { store } = context;
    const { id, blockNumber } = args;

    if (!id) return null;

    const entityInstance = await store.findUnique({
      modelName: entity.name,
      id,
      blockNumber,
    });

    return entityInstance;
  };

  return {
    type: entityGqlType,
    args: {
      id: { type: new GraphQLNonNull(entity.fieldByName.id.scalarGqlType) },
      blockNumber: { type: GraphQLInt },
    },
    resolve: resolver,
  };
};

export { buildSingularField };
