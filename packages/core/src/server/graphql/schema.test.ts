import { type GraphQLType } from "graphql";
import { expect, test } from "vitest";

import { createSchema } from "@/schema/schema.js";

import { buildGqlSchema } from "./schema.js";

test("filter type has correct suffixes and types", () => {
  const s = createSchema((p) => ({
    SimpleEnum: p.createEnum(["VALUE", "ANOTHER_VALUE"]),
    RelatedTableStringId: p.createTable({ id: p.string() }),
    RelatedTableBigIntId: p.createTable({ id: p.bigint() }),
    Table: p.createTable({
      id: p.string(),
      int: p.int(),
      float: p.float(),
      bool: p.boolean(),
      bytes: p.bytes(),
      bigint: p.bigint(),
      enum: p.enum("SimpleEnum"),
      listString: p.string().list(),
      listBigInt: p.bigint().list(),
      listEnum: p.enum("SimpleEnum").list(),
      relatedTableStringId: p.string().references("RelatedTableStringId.id"),
      relatedTableBigIntId: p.bigint().references("RelatedTableBigIntId.id"),
      relatedTableString: p.one("relatedTableStringId"),
    }),
  }));

  const serverSchema = buildGqlSchema(s);

  const typeMap = serverSchema.getTypeMap();

  const tableFilterType = typeMap["TableFilter"];
  const fields = (tableFilterType.toConfig() as any).fields as Record<
    string,
    { name: string; type: GraphQLType }
  >;

  const fieldsPretty = Object.entries(fields).reduce<Record<string, any>>(
    (acc, [key, value]) => {
      acc[key] = value.type.toString();
      return acc;
    },
    {},
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
    bigint: "BigInt",
    bigint_not: "BigInt",
    bigint_in: "[BigInt]",
    bigint_not_in: "[BigInt]",
    bigint_gt: "BigInt",
    bigint_lt: "BigInt",
    bigint_gte: "BigInt",
    bigint_lte: "BigInt",
    enum: "SimpleEnum",
    enum_not: "SimpleEnum",
    enum_in: "[SimpleEnum]",
    enum_not_in: "[SimpleEnum]",
    listString: "[String]",
    listString_not: "[String]",
    listString_has: "String",
    listString_not_has: "String",
    listBigInt: "[BigInt]",
    listBigInt_not: "[BigInt]",
    listBigInt_has: "BigInt",
    listBigInt_not_has: "BigInt",
    listEnum: "[SimpleEnum]",
    listEnum_not: "[SimpleEnum]",
    listEnum_has: "SimpleEnum",
    listEnum_not_has: "SimpleEnum",
    relatedTableStringId: "String",
    relatedTableStringId_not: "String",
    relatedTableStringId_in: "[String]",
    relatedTableStringId_not_in: "[String]",
    relatedTableStringId_contains: "String",
    relatedTableStringId_not_contains: "String",
    relatedTableStringId_starts_with: "String",
    relatedTableStringId_ends_with: "String",
    relatedTableStringId_not_starts_with: "String",
    relatedTableStringId_not_ends_with: "String",
    relatedTableBigIntId: "BigInt",
    relatedTableBigIntId_not: "BigInt",
    relatedTableBigIntId_in: "[BigInt]",
    relatedTableBigIntId_not_in: "[BigInt]",
    relatedTableBigIntId_gt: "BigInt",
    relatedTableBigIntId_lt: "BigInt",
    relatedTableBigIntId_gte: "BigInt",
    relatedTableBigIntId_lte: "BigInt",
  });
});
