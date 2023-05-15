import { buildSchema as buildGraphqlSchema } from "graphql";
import { describe, expect, test } from "vitest";

import { buildEntityTypes } from "@/codegen/buildEntityTypes";
import { schemaHeader } from "@/reload/readGraphqlSchema";
import { buildSchema } from "@/schema/buildSchema";

describe("entity types builder", () => {
  test("entity generated successfully", () => {
    const graphqlSchema = buildGraphqlSchema(`
      ${schemaHeader}

      type Entity @entity {
        id: String!
        int: Int
        float: Float
        bool: Boolean
        bytes: Bytes
        bigInt: BigInt
        nonNullInt: Int!
        nonNullFloat: Float!
        nonNullBool: Boolean!
        nonNullBytes: Bytes!
        nonNullBigInt: BigInt!
      }
    `);

    const schema = buildSchema(graphqlSchema);
    const output = buildEntityTypes(schema.entities);
    expect(output).not.toBeNull();
  });
});
