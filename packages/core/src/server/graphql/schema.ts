import {
  type GraphQLFieldConfig,
  GraphQLBoolean,
  GraphQLFloat,
  GraphQLInt,
  GraphQLObjectType,
  GraphQLScalarType,
  GraphQLSchema,
  GraphQLString,
} from "graphql";

import type { Scalar, Schema } from "@/schema/types";
import type { UserStore } from "@/user-store/store";

import { buildEntityType } from "./entity";
import { buildPluralField } from "./plural";
import { buildSingularField } from "./singular";

const GraphQLBigInt = new GraphQLScalarType({
  name: "BigInt",
  serialize: (value) => String(value),
  parseValue: (value) => BigInt(value),
  parseLiteral: (value) => {
    if (value.kind === "StringValue") {
      return BigInt(value.value);
    } else {
      throw new Error(
        `Invalid value kind provided for field of type BigInt: ${value.kind}. Expected: StringValue`
      );
    }
  },
});

export const tsTypeToGqlScalar: { [type in Scalar]: GraphQLScalarType } = {
  int: GraphQLInt,
  float: GraphQLFloat,
  string: GraphQLString,
  boolean: GraphQLBoolean,
  bigint: GraphQLBigInt,
  bytes: GraphQLString,
};

export type Source = { request: unknown };
export type Context = { store: UserStore };

export const buildGqlSchema = (schema: Schema): GraphQLSchema => {
  const queryFields: Record<string, GraphQLFieldConfig<Source, Context>> = {};

  const entityGqlTypes: Record<string, GraphQLObjectType<Source, Context>> = {};

  // First build the entity types. These have resolvers defined for any
  // relationship or derived fields. This is also important for the thunk nonsense.
  for (const entity of schema.entities) {
    entityGqlTypes[entity.name] = buildEntityType({
      entity,
      entities: schema.entities,
      entityGqlTypes,
    });
  }

  for (const entity of schema.entities) {
    const entityGqlType = entityGqlTypes[entity.name];

    const singularFieldName =
      entity.name.charAt(0).toLowerCase() + entity.name.slice(1);
    queryFields[singularFieldName] = buildSingularField({
      entity,
      entityGqlType,
    });

    const pluralFieldName = singularFieldName + "s";
    queryFields[pluralFieldName] = buildPluralField({ entity, entityGqlType });
  }

  const queryType = new GraphQLObjectType({
    name: "Query",
    fields: queryFields,
  });

  const gqlSchema = new GraphQLSchema({
    query: queryType,
  });

  return gqlSchema;
};
