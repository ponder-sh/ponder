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

import type { IndexingStore } from "@/indexing-store/store";
import type { Scalar, Schema } from "@/schema/types";

import { buildEntityTypes } from "./entity";
import { buildPluralField } from "./plural";
import { buildSingularField } from "./singular";

const GraphQLBigInt = new GraphQLScalarType({
  name: "BigInt",
  serialize: (value) => String(value),
  // TODO: Kyle this cast is probably a bad idea.
  parseValue: (value) => BigInt(value as any),
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
export type Context = { store: IndexingStore };

export const buildGqlSchema = (schema: Schema): GraphQLSchema => {
  const queryFields: Record<string, GraphQLFieldConfig<Source, Context>> = {};

  // First build the entity types. These have resolvers defined for any
  // relationship or derived fields. This is also important for the thunk nonsense.
  const entityGqlTypes = buildEntityTypes({
    schema,
  });

  for (const [tableName, table] of Object.entries(schema.tables)) {
    const entityGqlType = entityGqlTypes[tableName];

    const singularFieldName =
      tableName.charAt(0).toLowerCase() + tableName.slice(1);
    queryFields[singularFieldName] = buildSingularField({
      tableName,
      table,
      entityGqlType,
    });

    const pluralFieldName = singularFieldName + "s";
    queryFields[pluralFieldName] = buildPluralField({
      table,
      tableName,
      entityGqlType,
    });
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
