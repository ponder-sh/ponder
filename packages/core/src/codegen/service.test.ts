import { buildSchema as buildGraphqlSchema } from "graphql";
import { expect, test } from "vitest";

import { schemaHeader } from "@/build/schema.js";
import { buildEntityTypes } from "@/codegen/entity.js";
import { buildSchema } from "@/schema/schema.js";

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

test("entity type codegen succeeds", () => {
  const schema = buildSchema(graphqlSchema);
  const output = buildEntityTypes(schema.entities);
  expect(output).not.toBeNull();
});
