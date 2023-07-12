import { buildSchema as _buildGraphqlSchema } from "graphql";
import { expect, test } from "vitest";

import { schemaHeader } from "@/build/schema";

import { buildSchema } from "./schema";
import {
  type DerivedField,
  type EnumField,
  type ListField,
  type RelationshipField,
  type ScalarField,
} from "./types";

const buildGraphqlSchema = (source: string) => {
  return _buildGraphqlSchema(schemaHeader + source);
};

test("ID field must be a String, BigInt, Int, or Bytes", () => {
  const graphqlSchema = buildGraphqlSchema(`
    type Entity @entity {
      id: ID!
    }
  `);

  expect(() => buildSchema(graphqlSchema)).toThrowErrorMatchingInlineSnapshot(`
    "Entity.id field must be a String, BigInt, Int, or Bytes."
  `);
});

test("scalar String field", () => {
  const graphqlSchema = buildGraphqlSchema(`
    type Entity @entity {
      id: String!
    }
  `);

  const schema = buildSchema(graphqlSchema);
  const entity = schema.entities.find((e) => e.name === "Entity");
  const idField = entity?.fields.find((f): f is ScalarField => f.name === "id");
  expect(idField?.kind).toBe("SCALAR");
  expect(idField?.scalarTypeName).toBe("String");
  expect(idField?.scalarGqlType.toString()).toBe("String");
});

test("scalar Int field", () => {
  const graphqlSchema = buildGraphqlSchema(`
    type Entity @entity {
      id: Int!
    }
  `);

  const schema = buildSchema(graphqlSchema);
  const entity = schema.entities.find((e) => e.name === "Entity");
  const idField = entity?.fields.find((f): f is ScalarField => f.name === "id");
  expect(idField?.kind).toBe("SCALAR");
  expect(idField?.scalarTypeName).toBe("Int");
  expect(idField?.scalarGqlType.toString()).toBe("Int");
});

test("scalar Float field", () => {
  const graphqlSchema = buildGraphqlSchema(`
    type Entity @entity {
      id: String!
      balance: Float!
    }
  `);

  const schema = buildSchema(graphqlSchema);
  const entity = schema.entities.find((e) => e.name === "Entity");
  const idField = entity?.fields.find(
    (f): f is ScalarField => f.name === "balance"
  );
  expect(idField?.kind).toBe("SCALAR");
  expect(idField?.scalarTypeName).toBe("Float");
  expect(idField?.scalarGqlType.toString()).toBe("Float");
});

test("scalar BigInt field", () => {
  const graphqlSchema = buildGraphqlSchema(`
    type Entity @entity {
      id: BigInt!
    }
  `);

  const schema = buildSchema(graphqlSchema);
  const entity = schema.entities.find((e) => e.name === "Entity");
  const idField = entity?.fields.find((f): f is ScalarField => f.name === "id");
  expect(idField?.kind).toBe("SCALAR");
  expect(idField?.scalarTypeName).toBe("BigInt");
  expect(idField?.scalarGqlType.toString()).toBe("BigInt");
});

test("scalar Bytes field", () => {
  const graphqlSchema = buildGraphqlSchema(`
    type Entity @entity {
      id: Bytes!
    }
  `);

  const schema = buildSchema(graphqlSchema);
  const entity = schema.entities.find((e) => e.name === "Entity");
  const idField = entity?.fields.find((f): f is ScalarField => f.name === "id");
  expect(idField?.kind).toBe("SCALAR");
  expect(idField?.scalarTypeName).toBe("Bytes");
  expect(idField?.scalarGqlType.toString()).toBe("String");
});

test("non-null fields", () => {
  const graphqlSchema = buildGraphqlSchema(`
    type Entity @entity {
      id: String!
      bigInt: BigInt
      bytes: Bytes
      nonNullBigInt: BigInt!
      nonNullBytes: Bytes!
    }
  `);

  const schema = buildSchema(graphqlSchema);

  const entity = schema.entities.find((e) => e.name === "Entity");
  expect(entity).toBeDefined();

  const bigIntField = entity?.fieldByName["bigInt"];
  expect(bigIntField).toBeDefined();
  expect(bigIntField?.notNull).toBe(false);

  const bytesField = entity?.fieldByName["bytes"];
  expect(bytesField).toBeDefined();
  expect(bytesField?.notNull).toBe(false);

  const nonNullBigIntField = entity?.fieldByName["nonNullBigInt"];
  expect(nonNullBigIntField).toBeDefined();
  expect(nonNullBigIntField?.notNull).toBe(true);

  const nonNullBytesField = entity?.fieldByName["nonNullBytes"];
  expect(nonNullBytesField).toBeDefined();
  expect(nonNullBytesField?.notNull).toBe(true);
});

test("custom scalars are not supported", () => {
  const graphqlSchema = buildGraphqlSchema(`
    scalar CustomScalar
  `);

  expect(() => buildSchema(graphqlSchema)).toThrowErrorMatchingInlineSnapshot(`
  "Custom scalars are not supported: CustomScalar"
`);
});

test("enum with a single value", () => {
  const graphqlSchema = buildGraphqlSchema(`
    enum SingleEnum {
      VALUE
    }

    type Entity @entity {
      enum: SingleEnum
    }
  `);

  const schema = buildSchema(graphqlSchema);
  const entity = schema.entities.find((e) => e.name === "Entity");
  const enumField = entity?.fields.find(
    (f): f is EnumField => f.name === "enum"
  );
  expect(enumField?.kind).toBe("ENUM");
  expect(enumField?.notNull).toBe(false);
  expect(enumField?.enumGqlType.toString()).toBe("SingleEnum");
  expect(enumField?.enumValues).toMatchObject(["VALUE"]);
});

test("enum with multiple values", () => {
  const graphqlSchema = buildGraphqlSchema(`
    enum MultipleEnum {
      VALUE
      ANOTHER_VALUE
    }

    type Entity @entity {
      enum: MultipleEnum!
    }
  `);

  const schema = buildSchema(graphqlSchema);
  const entity = schema.entities.find((e) => e.name === "Entity");
  const enumField = entity?.fields.find(
    (f): f is EnumField => f.name === "enum"
  );
  expect(enumField?.kind).toBe("ENUM");
  expect(enumField?.notNull).toBe(true);
  expect(enumField?.enumGqlType.toString()).toBe("MultipleEnum");
  expect(enumField?.enumValues).toMatchObject(["VALUE", "ANOTHER_VALUE"]);
});

test("basic list of scalars", () => {
  const graphqlSchema = buildGraphqlSchema(`
    type Entity @entity {
      list: [String!]!
    }
  `);

  const schema = buildSchema(graphqlSchema);
  const entity = schema.entities.find((e) => e.name === "Entity");
  const listField = entity?.fields.find(
    (f): f is ListField => f.name === "list"
  );
  expect(listField?.kind).toBe("LIST");
  expect(listField?.notNull).toBe(true);
  expect(listField?.isListElementNotNull).toBe(true);
  expect(listField?.baseGqlType.toString()).toBe("String");
});

test("basic list of enums", () => {
  const graphqlSchema = buildGraphqlSchema(`
    enum MultipleEnum {
      VALUE
      ANOTHER_VALUE
    }

    type Entity @entity {
      list: [MultipleEnum!]!
    }
  `);

  const schema = buildSchema(graphqlSchema);
  const entity = schema.entities.find((e) => e.name === "Entity");
  const listField = entity?.fields.find(
    (f): f is ListField => f.name === "list"
  );
  expect(listField?.kind).toBe("LIST");
  expect(listField?.notNull).toBe(true);
  expect(listField?.isListElementNotNull).toBe(true);
  expect(listField?.baseGqlType.toString()).toBe("MultipleEnum");
});

test("basic list of enums with nullable elements", () => {
  const graphqlSchema = buildGraphqlSchema(`
    enum MultipleEnum {
      VALUE
      ANOTHER_VALUE
    }

    type Entity @entity {
      list: [MultipleEnum]!
    }
  `);

  const schema = buildSchema(graphqlSchema);
  const entity = schema.entities.find((e) => e.name === "Entity");
  const listField = entity?.fields.find(
    (f): f is ListField => f.name === "list"
  );
  expect(listField?.kind).toBe("LIST");
  expect(listField?.notNull).toBe(true);
  expect(listField?.isListElementNotNull).toBe(false);
  expect(listField?.baseGqlType.toString()).toBe("MultipleEnum");
});

test("basic nullable list of enums with nullable elements", () => {
  const graphqlSchema = buildGraphqlSchema(`
    enum MultipleEnum {
      VALUE
      ANOTHER_VALUE
    }

    type Entity @entity {
      list: [MultipleEnum]
    }
  `);

  const schema = buildSchema(graphqlSchema);
  const entity = schema.entities.find((e) => e.name === "Entity");
  const listField = entity?.fields.find(
    (f): f is ListField => f.name === "list"
  );
  expect(listField?.kind).toBe("LIST");
  expect(listField?.notNull).toBe(false);
  expect(listField?.isListElementNotNull).toBe(false);
  expect(listField?.baseGqlType.toString()).toBe("MultipleEnum");
});

test("relationship field with String id", () => {
  const graphqlSchema = buildGraphqlSchema(`
    type Entity @entity {
      relatedEntity: RelatedEntity!
    }

    type RelatedEntity @entity {
      id: String!
    }
  `);

  const schema = buildSchema(graphqlSchema);
  const entity = schema.entities.find((e) => e.name === "Entity");
  const relationshipField = entity?.fields.find(
    (f): f is RelationshipField => f.name === "relatedEntity"
  );
  expect(relationshipField?.kind).toBe("RELATIONSHIP");
  expect(relationshipField?.notNull).toBe(true);
  expect(relationshipField?.relatedEntityName).toBe("RelatedEntity");
  expect(relationshipField?.relatedEntityIdType.name).toBe("String");
});

test("relationship field with Int id", () => {
  const graphqlSchema = buildGraphqlSchema(`
    type Entity @entity {
      relatedEntity: RelatedEntity!
    }

    type RelatedEntity @entity {
      id: Int!
    }
  `);

  const schema = buildSchema(graphqlSchema);
  const entity = schema.entities.find((e) => e.name === "Entity");
  const relationshipField = entity?.fields.find(
    (f): f is RelationshipField => f.name === "relatedEntity"
  );
  expect(relationshipField?.kind).toBe("RELATIONSHIP");
  expect(relationshipField?.notNull).toBe(true);
  expect(relationshipField?.relatedEntityName).toBe("RelatedEntity");
  expect(relationshipField?.relatedEntityIdType.name).toBe("Int");
});

test("relationship field with BigInt id", () => {
  const graphqlSchema = buildGraphqlSchema(`
    type Entity @entity {
      relatedEntity: RelatedEntity!
    }

    type RelatedEntity @entity {
      id: BigInt!
    }
  `);

  const schema = buildSchema(graphqlSchema);
  const entity = schema.entities.find((e) => e.name === "Entity");
  const relationshipField = entity?.fields.find(
    (f): f is RelationshipField => f.name === "relatedEntity"
  );
  expect(relationshipField?.kind).toBe("RELATIONSHIP");
  expect(relationshipField?.notNull).toBe(true);
  expect(relationshipField?.relatedEntityName).toBe("RelatedEntity");
  expect(relationshipField?.relatedEntityIdType.name).toBe("BigInt");
});

test("relationship field with Bytes id", () => {
  const graphqlSchema = buildGraphqlSchema(`
    type Entity @entity {
      relatedEntity: RelatedEntity!
    }

    type RelatedEntity @entity {
      id: Bytes!
    }
  `);

  const schema = buildSchema(graphqlSchema);
  const entity = schema.entities.find((e) => e.name === "Entity");
  const relationshipField = entity?.fields.find(
    (f): f is RelationshipField => f.name === "relatedEntity"
  );
  expect(relationshipField?.kind).toBe("RELATIONSHIP");
  expect(relationshipField?.notNull).toBe(true);
  expect(relationshipField?.relatedEntityName).toBe("RelatedEntity");
  expect(relationshipField?.relatedEntityIdType.name).toBe("String");
});

test("relationship field with Bytes id", () => {
  const graphqlSchema = buildGraphqlSchema(`
    type Entity @entity {
      relatedEntity: RelatedEntity
    }

    type RelatedEntity @entity {
      id: Bytes!
    }
  `);

  const schema = buildSchema(graphqlSchema);
  const entity = schema.entities.find((e) => e.name === "Entity");
  const relationshipField = entity?.fields.find(
    (f): f is RelationshipField => f.name === "relatedEntity"
  );
  expect(relationshipField?.kind).toBe("RELATIONSHIP");
  expect(relationshipField?.notNull).toBe(false);
  expect(relationshipField?.relatedEntityName).toBe("RelatedEntity");
  expect(relationshipField?.relatedEntityIdType.name).toBe("String");
});

test("derivedFrom field with missing id field", () => {
  const graphqlSchema = buildGraphqlSchema(`
    type Entity @entity {
      relatedEntity: RelatedEntity!
    }

    type RelatedEntity @entity {
      entities: [Entity!]! @derivedFrom(field: "relatedEntity")
    }
  `);

  expect(() => buildSchema(graphqlSchema)).toThrowErrorMatchingInlineSnapshot(
    `"Related entity is missing an id field: RelatedEntity"`
  );
});

test("derivedFrom field where id field is not a scalar", () => {
  const graphqlSchema = buildGraphqlSchema(`
    type Entity @entity {
      relatedEntity: RelatedEntity!
    }

    enum Enum {
      VALUE
    }

    type RelatedEntity @entity {
      id: Enum!
      entities: [Entity!]! @derivedFrom(field: "relatedEntity")
    }
  `);

  expect(() => buildSchema(graphqlSchema)).toThrowErrorMatchingInlineSnapshot(
    `"Related entity id field is not a scalar: RelatedEntity"`
  );
});

test("derivedFrom field where id field is valid", () => {
  const graphqlSchema = buildGraphqlSchema(`
    type Entity @entity {
      relatedEntity: RelatedEntity!
    }

    type RelatedEntity @entity {
      id: Int!
      entities: [Entity!]! @derivedFrom(field: "relatedEntity")
    }
  `);

  const schema = buildSchema(graphqlSchema);
  const entity = schema.entities.find((e) => e.name === "RelatedEntity");
  const derivedFromField = entity?.fields.find(
    (f): f is DerivedField => f.name === "entities"
  );
  expect(derivedFromField?.kind).toBe("DERIVED");
  expect(derivedFromField?.notNull).toBe(true);
  expect(derivedFromField?.derivedFromEntityName).toBe("Entity");
  expect(derivedFromField?.derivedFromFieldName).toBe("relatedEntity");
});
