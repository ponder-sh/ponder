import type { GraphQLObjectType } from "graphql";
import {
  type GraphQLFieldConfig,
  type GraphQLFieldResolver,
  GraphQLInt,
  GraphQLNonNull,
} from "graphql";

import type { Entity } from "@/schema/types.js";

import type { Context, Source } from "./schema.js";

type SingularArgs = {
  id?: string;
  timestamp?: number;
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
    const { id, timestamp } = args;

    if (id === undefined) return null;

    const entityInstance = await store.findUnique({
      modelName: entity.name,
      id,
      timestamp,
    });

    return entityInstance;
  };

  return {
    type: entityGqlType,
    args: {
      id: { type: new GraphQLNonNull(entity.fieldByName.id.scalarGqlType) },
      timestamp: { type: GraphQLInt },
    },
    resolve: resolver,
  };
};

export { buildSingularField };
