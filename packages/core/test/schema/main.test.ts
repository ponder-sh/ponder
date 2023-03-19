import { buildSchema as _buildGraphqlSchema } from "graphql";
import { describe, expect, test } from "vitest";

import { schemaHeader } from "@/reload/readGraphqlSchema";
import { buildSchema } from "@/schema/buildSchema";
import { EnumField, FieldKind, ScalarField } from "@/schema/types";

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
