import {
  GraphQLFieldConfig,
  GraphQLFieldResolver,
  GraphQLID,
  GraphQLInt,
  GraphQLNonNull,
  GraphQLObjectType,
} from "graphql";

import type { Entity } from "@/schema/types";
import { MAX_INTEGER } from "@/user-store/utils";

import type { Context, Source } from "./buildGqlSchema";

type SingularArgs = {
  id?: string;
  timestamp?: number;
};
type SingularResolver = GraphQLFieldResolver<Source, Context, SingularArgs>;

const buildSingularField = (
  entity: Entity,
  entityType: GraphQLObjectType<Source, Context>
): GraphQLFieldConfig<Source, Context> => {
  const resolver: SingularResolver = async (_, args, context) => {
    const { store } = context;
    const { id } = args;
    let { timestamp } = args;

    if (!id) return null;
    if (!timestamp) timestamp = MAX_INTEGER;

    const entityInstance = await store.findUnique({
      modelName: entity.name,
      timestamp,
      id,
    });

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
      timestamp: { type: GraphQLInt },
    },
    resolve: resolver,
  };
};

export { buildSingularField };
