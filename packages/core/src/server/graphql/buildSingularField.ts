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
      // If the type of the ID field is BigInt, it will be serialized as a String.
      // Must convert it to a BigInt before passing to the store method.
      id: entity.fieldByName.id.scalarTypeName === "BigInt" ? BigInt(id) : id,
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
