import {
  GraphQLFieldConfig,
  GraphQLFieldResolver,
  GraphQLID,
  GraphQLNonNull,
} from "graphql";

import { Entity } from "@/core/schema/types";

import type { Context, Source } from "./buildGqlSchema";

type SingularArgs = {
  id?: string;
};
type SingularResolver = GraphQLFieldResolver<Source, Context, SingularArgs>;

const buildSingularField = (
  entity: Entity
): GraphQLFieldConfig<Source, Context> => {
  const resolver: SingularResolver = async (_, args, context) => {
    const { store } = context;
    const { id } = args;

    if (!id) return null;

    return await store.getEntity(entity.name, id);

    // const entityInstance = (await store.getEntity(entity.name, id)) as any;

    // // Build resolvers for any relationship fields on the entity.
    // entity.fields
    //   .filter(
    //     (field): field is RelationshipField =>
    //       field.kind === FieldKind.RELATIONSHIP
    //   )
    //   .forEach((field) => {
    //     const relatedEntityId = entityInstance[field.name];

    //     entityInstance[field.name] = async () => {
    //       return await store.getEntity(field.baseGqlType.name, relatedEntityId);
    //     };
    //   });
  };

  return {
    type: entity.gqlType,
    args: {
      id: { type: new GraphQLNonNull(GraphQLID) },
    },
    resolve: resolver,
  };
};

export { buildSingularField };
