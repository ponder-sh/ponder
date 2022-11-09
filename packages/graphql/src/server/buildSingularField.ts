import type { Entity } from "@ponder/ponder";
import {
  GraphQLFieldConfig,
  GraphQLFieldResolver,
  GraphQLID,
  GraphQLNonNull,
  GraphQLObjectType,
} from "graphql";

import type { Context, Source } from "./buildGqlSchema";

type SingularArgs = {
  id?: string;
};
type SingularResolver = GraphQLFieldResolver<Source, Context, SingularArgs>;

const buildSingularField = (
  entity: Entity,
  entityType: GraphQLObjectType<Source, Context>
): GraphQLFieldConfig<Source, Context> => {
  const resolver: SingularResolver = async (_, args, context) => {
    const { store } = context;
    const { id } = args;

    if (!id) return null;

    const entityInstance = await store.getEntity(entity.name, id);

    // // Build resolvers for relationship fields on the entity.
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

    // // Build resolvers for derived fields on the entity.
    // entity.fields
    //   .filter(
    //     (field): field is DerivedField => field.kind === FieldKind.DERIVED
    //   )
    //   .forEach((derivedField) => {
    //     entityInstance[derivedField.name] = async () => {
    //       return await store.getEntityDerivedField(
    //         entity.name,
    //         id,
    //         derivedField.name
    //       );
    //     };
    //   });

    return entityInstance;
  };

  return {
    type: entityType,
    args: {
      id: { type: new GraphQLNonNull(GraphQLID) },
    },
    resolve: resolver,
  };
};

export { buildSingularField };
