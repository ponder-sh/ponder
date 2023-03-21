import {
  buildSchema as _buildGraphqlSchema,
  GraphQLInt,
  GraphQLString,
} from "graphql";
import { describe, expect, test } from "vitest";

import { schemaHeader } from "@/reload/readGraphqlSchema";
import { buildSchema } from "@/schema/buildSchema";
import {
  DerivedField,
  EnumField,
  FieldKind,
  ListField,
  RelationshipField,
  ScalarField,
} from "@/schema/types";

const buildGraphqlSchema = (source: string) => {
  return _buildGraphqlSchema(schemaHeader + source);
};

describe("scalar fields", () => {
  describe("id field", () => {
    test("ID", () => {
      const graphqlSchema = buildGraphqlSchema(`
        type Entity @entity {
          id: ID!
        }
      `);

      expect(() => buildSchema(graphqlSchema))
        .toThrowErrorMatchingInlineSnapshot(`
        "Entity.id field must be a String, BigInt, Int, or Bytes."
      `);
    });

    test("String", () => {
      const graphqlSchema = buildGraphqlSchema(`
        type Entity @entity {
          id: String!
        }
      `);

      const schema = buildSchema(graphqlSchema);
      const entity = schema.entities.find((e) => e.name === "Entity");
      const idField = entity?.fields.find(
        (f): f is ScalarField => f.name === "id"
      );
      expect(idField?.kind).toBe(FieldKind.SCALAR);
      expect(idField?.scalarTypeName).toBe("String");
      expect(idField?.scalarGqlType.toString()).toBe("String");
    });

    test("Int", () => {
      const graphqlSchema = buildGraphqlSchema(`
        type Entity @entity {
          id: Int!
        }
      `);

      const schema = buildSchema(graphqlSchema);
      const entity = schema.entities.find((e) => e.name === "Entity");
      const idField = entity?.fields.find(
        (f): f is ScalarField => f.name === "id"
      );
      expect(idField?.kind).toBe(FieldKind.SCALAR);
      expect(idField?.scalarTypeName).toBe("Int");
      expect(idField?.scalarGqlType.toString()).toBe("Int");
    });

    test("BigInt", () => {
      const graphqlSchema = buildGraphqlSchema(`
        type Entity @entity {
          id: BigInt!
        }
      `);

      const schema = buildSchema(graphqlSchema);
      const entity = schema.entities.find((e) => e.name === "Entity");
      const idField = entity?.fields.find(
        (f): f is ScalarField => f.name === "id"
      );
      expect(idField?.kind).toBe(FieldKind.SCALAR);
      expect(idField?.scalarTypeName).toBe("BigInt");
      expect(idField?.scalarGqlType.toString()).toBe("String");
    });

    test("Bytes", () => {
      const graphqlSchema = buildGraphqlSchema(`
        type Entity @entity {
          id: Bytes!
        }
      `);

      const schema = buildSchema(graphqlSchema);
      const entity = schema.entities.find((e) => e.name === "Entity");
      const idField = entity?.fields.find(
        (f): f is ScalarField => f.name === "id"
      );
      expect(idField?.kind).toBe(FieldKind.SCALAR);
      expect(idField?.scalarTypeName).toBe("Bytes");
      expect(idField?.scalarGqlType.toString()).toBe("String");
    });
  });

  test("non-null", () => {
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

  test("custom scalars", () => {
    const graphqlSchema = buildGraphqlSchema(`
    scalar CustomScalar
  `);

    expect(() => buildSchema(graphqlSchema))
      .toThrowErrorMatchingInlineSnapshot(`
    "Custom scalars are not supported: CustomScalar"
  `);
  });
});

describe("enum fields", () => {
  test("single enum", () => {
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
    expect(enumField?.kind).toBe(FieldKind.ENUM);
    expect(enumField?.notNull).toBe(false);
    expect(enumField?.enumGqlType.toString()).toBe("SingleEnum");
    expect(enumField?.enumValues).toMatchObject(["VALUE"]);
  });

  test("multiple enum", () => {
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
    expect(enumField?.kind).toBe(FieldKind.ENUM);
    expect(enumField?.notNull).toBe(true);
    expect(enumField?.enumGqlType.toString()).toBe("MultipleEnum");
    expect(enumField?.enumValues).toMatchObject(["VALUE", "ANOTHER_VALUE"]);
  });
});

describe("list fields", () => {
  test("list of scalars", () => {
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
    expect(listField?.kind).toBe(FieldKind.LIST);
    expect(listField?.notNull).toBe(true);
    expect(listField?.isListElementNotNull).toBe(true);
    expect(listField?.baseGqlType.toString()).toBe("String");
  });

  test("list of enums", () => {
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
    expect(listField?.kind).toBe(FieldKind.LIST);
    expect(listField?.notNull).toBe(true);
    expect(listField?.isListElementNotNull).toBe(true);
    expect(listField?.baseGqlType.toString()).toBe("MultipleEnum");
  });

  test("list of enums, element null", () => {
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
    expect(listField?.kind).toBe(FieldKind.LIST);
    expect(listField?.notNull).toBe(true);
    expect(listField?.isListElementNotNull).toBe(false);
    expect(listField?.baseGqlType.toString()).toBe("MultipleEnum");
  });

  test("list of enums, both null", () => {
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
    expect(listField?.kind).toBe(FieldKind.LIST);
    expect(listField?.notNull).toBe(false);
    expect(listField?.isListElementNotNull).toBe(false);
    expect(listField?.baseGqlType.toString()).toBe("MultipleEnum");
  });
});

describe("relationship fields", () => {
  test("related entity has String id", () => {
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
    expect(relationshipField?.kind).toBe(FieldKind.RELATIONSHIP);
    expect(relationshipField?.notNull).toBe(true);
    expect(relationshipField?.relatedEntityName).toBe("RelatedEntity");
    expect(relationshipField?.relatedEntityIdType).toBe(GraphQLString);
  });

  test("related entity has Int id", () => {
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
    expect(relationshipField?.kind).toBe(FieldKind.RELATIONSHIP);
    expect(relationshipField?.notNull).toBe(true);
    expect(relationshipField?.relatedEntityName).toBe("RelatedEntity");
    expect(relationshipField?.relatedEntityIdType).toBe(GraphQLInt);
  });

  test("related entity has BigInt id", () => {
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
    expect(relationshipField?.kind).toBe(FieldKind.RELATIONSHIP);
    expect(relationshipField?.notNull).toBe(true);
    expect(relationshipField?.relatedEntityName).toBe("RelatedEntity");
    expect(relationshipField?.relatedEntityIdType).toBe(GraphQLString);
  });

  test("related entity has Bytes id", () => {
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
    expect(relationshipField?.kind).toBe(FieldKind.RELATIONSHIP);
    expect(relationshipField?.notNull).toBe(true);
    expect(relationshipField?.relatedEntityName).toBe("RelatedEntity");
    expect(relationshipField?.relatedEntityIdType).toBe(GraphQLString);
  });

  test("related entity is nullable", () => {
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
    expect(relationshipField?.kind).toBe(FieldKind.RELATIONSHIP);
    expect(relationshipField?.notNull).toBe(false);
    expect(relationshipField?.relatedEntityName).toBe("RelatedEntity");
    expect(relationshipField?.relatedEntityIdType).toBe(GraphQLString);
  });
});

describe("derivedFrom fields", () => {
  test("related entity is missing id field", () => {
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

  test("related entity id field is not a scalar", () => {
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

  test("related entity is valid", () => {
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
    expect(derivedFromField?.kind).toBe(FieldKind.DERIVED);
    expect(derivedFromField?.notNull).toBe(true);
    expect(derivedFromField?.derivedFromEntityName).toBe("Entity");
    expect(derivedFromField?.derivedFromFieldName).toBe("relatedEntity");
  });
});
