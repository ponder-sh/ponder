import { buildSchema as _buildGraphqlSchema, GraphQLType } from "graphql";
import { expect, test } from "vitest";

import { schemaHeader } from "@/build/schema";
import { buildSchema as _buildSchema } from "@/schema/schema";

import { buildGqlSchema } from "./schema";

const buildSchema = (source: string) => {
  return _buildSchema(_buildGraphqlSchema(schemaHeader + source));
};

test("filter type has correct suffixes and types", () => {
  const schema = buildSchema(`
    enum SimpleEnum {
      VALUE
      ANOTHER_VALUE
    }

    type RelatedEntityStringId @entity {
      id: String!
    }

    type RelatedEntityBigIntId @entity {
      id: BigInt!
    }

    type Entity @entity {
      id: String!
      int: Int!
      float: Float!
      bool: Boolean!
      bytes: Bytes!
      bigInt: BigInt!
      enum: SimpleEnum!
      listString: [String!]!
      listBigInt: [BigInt!]!
      listEnum: [SimpleEnum!]!
      relatedEntityStringId: RelatedEntityStringId!
      relatedEntityBigIntId: RelatedEntityBigIntId!
    }
  `);
  const serverSchema = buildGqlSchema(schema);

  const typeMap = serverSchema.getTypeMap();

  const entityFilterType = typeMap["EntityFilter"];
  const fields = (entityFilterType.toConfig() as any).fields as Record<
    string,
    { name: string; type: GraphQLType }
  >;

  const fieldsPretty = Object.entries(fields).reduce<Record<string, any>>(
    (acc, [key, value]) => {
      acc[key] = value.type.toString();
      return acc;
    },
    {}
  );

  expect(fieldsPretty).toMatchObject({
    id: "String",
    id_not: "String",
    id_in: "[String]",
    id_not_in: "[String]",
    id_contains: "String",
    id_not_contains: "String",
    id_starts_with: "String",
    id_ends_with: "String",
    id_not_starts_with: "String",
    id_not_ends_with: "String",
    int: "Int",
    int_not: "Int",
    int_in: "[Int]",
    int_not_in: "[Int]",
    int_gt: "Int",
    int_lt: "Int",
    int_gte: "Int",
    int_lte: "Int",
    float: "Float",
    float_not: "Float",
    float_in: "[Float]",
    float_not_in: "[Float]",
    float_gt: "Float",
    float_lt: "Float",
    float_gte: "Float",
    float_lte: "Float",
    bool: "Boolean",
    bool_not: "Boolean",
    bool_in: "[Boolean]",
    bool_not_in: "[Boolean]",
    bytes: "String",
    bytes_not: "String",
    bytes_in: "[String]",
    bytes_not_in: "[String]",
    bytes_contains: "String",
    bytes_not_contains: "String",
    bytes_starts_with: "String",
    bytes_ends_with: "String",
    bytes_not_starts_with: "String",
    bytes_not_ends_with: "String",
    bigInt: "BigInt",
    bigInt_not: "BigInt",
    bigInt_in: "[BigInt]",
    bigInt_not_in: "[BigInt]",
    bigInt_gt: "BigInt",
    bigInt_lt: "BigInt",
    bigInt_gte: "BigInt",
    bigInt_lte: "BigInt",
    enum: "SimpleEnum",
    enum_not: "SimpleEnum",
    enum_in: "[SimpleEnum]",
    enum_not_in: "[SimpleEnum]",
    listString: "[String]",
    listString_not: "[String]",
    listString_contains: "String",
    listString_not_contains: "String",
    listBigInt: "[BigInt]",
    listBigInt_not: "[BigInt]",
    listBigInt_contains: "BigInt",
    listBigInt_not_contains: "BigInt",
    listEnum: "[SimpleEnum]",
    listEnum_not: "[SimpleEnum]",
    listEnum_contains: "SimpleEnum",
    listEnum_not_contains: "SimpleEnum",
    relatedEntityStringId: "String",
    relatedEntityStringId_not: "String",
    relatedEntityStringId_in: "[String]",
    relatedEntityStringId_not_in: "[String]",
    relatedEntityStringId_contains: "String",
    relatedEntityStringId_not_contains: "String",
    relatedEntityStringId_starts_with: "String",
    relatedEntityStringId_ends_with: "String",
    relatedEntityStringId_not_starts_with: "String",
    relatedEntityStringId_not_ends_with: "String",
    relatedEntityBigIntId: "BigInt",
    relatedEntityBigIntId_not: "BigInt",
    relatedEntityBigIntId_in: "[BigInt]",
    relatedEntityBigIntId_not_in: "[BigInt]",
    relatedEntityBigIntId_gt: "BigInt",
    relatedEntityBigIntId_lt: "BigInt",
    relatedEntityBigIntId_gte: "BigInt",
    relatedEntityBigIntId_lte: "BigInt",
  });
});
