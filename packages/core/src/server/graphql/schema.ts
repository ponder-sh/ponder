import type { IndexingStore } from "@/indexing-store/store.js";
import type { Scalar, Schema } from "@/schema/types.js";
import {
  GraphQLBoolean,
  type GraphQLFieldConfig,
  GraphQLFloat,
  GraphQLInt,
  GraphQLObjectType,
  GraphQLScalarType,
  GraphQLSchema,
  GraphQLString,
} from "graphql";
import { buildEntityTypes } from "./entity.js";
import { buildPluralField } from "./plural.js";
import { buildSingularField } from "./singular.js";

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
        `Invalid value kind provided for field of type BigInt: ${value.kind}. Expected: StringValue`,
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
  hex: GraphQLString,
};

export type Source = { request: unknown };
export type Context = { store: IndexingStore };

export const buildGqlSchema = (schema: Schema): GraphQLSchema => {
  const queryFields: Record<string, GraphQLFieldConfig<Source, Context>> = {};

  // First build the entity types. These have resolvers defined for any
  // relationship or derived fields. This is also important for the thunk nonsense.
  const { entityTypes, entityPageTypes, enumTypes } = buildEntityTypes({
    schema,
  });

  for (const [tableName, table] of Object.entries(schema.tables)) {
    const entityType = entityTypes[tableName];
    const entityPageType = entityPageTypes[tableName];

    const singularFieldName =
      tableName.charAt(0).toLowerCase() + tableName.slice(1);
    queryFields[singularFieldName] = buildSingularField({
      tableName,
      table,
      entityType,
    });

    const pluralFieldName = `${singularFieldName}s`;
    queryFields[pluralFieldName] = buildPluralField({
      table,
      tableName,
      entityPageType,
      enumTypes,
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
