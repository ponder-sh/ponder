import {
  GraphQLFieldConfig,
  GraphQLFieldResolver,
  GraphQLNonNull,
  GraphQLObjectType,
} from "graphql";

import type { Entity } from "@/schema/types";

import type { Context, Source } from "./buildGqlSchema";

type SingularArgs = {
  id?: string;
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
    const { id } = args;

    if (!id) return null;

    const entityInstance = await store.findUnique({
      modelName: entity.name,
      id: id,
    });

    return entityInstance;
  };

  return {
    type: entityGqlType,
    args: {
      id: { type: new GraphQLNonNull(entity.fieldByName.id.scalarGqlType) },
    },
    resolve: resolver,
  };
};

export { buildSingularField };
