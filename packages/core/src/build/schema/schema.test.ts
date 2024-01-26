import { expect, test } from "vitest";

import { createSchema } from "@/schema/schema.js";
import { safeBuildSchema } from "./schema.js";

test("safeBuildSchema() returns error for duplicate enum values", () => {
  const schema = createSchema((p) => ({
    myEnum: p.createEnum(["duplicate", "duplicate"]),
  }));

  const result = safeBuildSchema({ schema });
  expect(result.success).toBe(false);
  expect(result.error?.message).toBe(
    "Validation failed: Enum 'myEnum' contains duplicate value 'duplicate'.",
  );
});

test("safeBuildSchema() returns error for table without ID column", () => {
  const schema = createSchema((p) => ({
    // @ts-expect-error
    myTable: p.createTable({}),
  }));

  const result = safeBuildSchema({ schema });
  expect(result.success).toBe(false);
  expect(result.error?.message).toBe(
    "Validation failed: Table 'myTable' does not have an 'id' column.",
  );
});

test("safeBuildSchema() returns error for ID column typed as an enum", () => {
  const schema = createSchema((p) => ({
    myEnum: p.createEnum(["value1", "value2"]),
    // @ts-expect-error
    myTable: p.createTable({
      id: p.enum("myEnum"),
    }),
  }));

  const result = safeBuildSchema({ schema });
  expect(result.success).toBe(false);
  expect(result.error?.message).toBe(
    "Validation failed: Invalid type for ID column 'myTable.id'. Got 'enum', expected one of ['string', 'hex', 'bigint', 'int'].",
  );
});

test("safeBuildSchema() returns error for ID column typed as a 'one' relationship", () => {
  const schema = createSchema((p) => ({
    // @ts-expect-error
    myTable: p.createTable({
      id: p.one("refTableId"),
      refTableId: p.string().references("refTable.id"),
    }),
    refTable: p.createTable({
      id: p.string(),
    }),
  }));

  const result = safeBuildSchema({ schema });
  expect(result.success).toBe(false);
  expect(result.error?.message).toBe(
    "Validation failed: Invalid type for ID column 'myTable.id'. Got 'one', expected one of ['string', 'hex', 'bigint', 'int'].",
  );
});

test("safeBuildSchema() returns error for ID column typed as a 'many' relationship", () => {
  const schema = createSchema((p) => ({
    // @ts-expect-error
    myTable: p.createTable({
      id: p.many("refTable.myTableId"),
    }),
    refTable: p.createTable({
      id: p.string(),
      myTableId: p.string().references("myTable.id"),
    }),
  }));

  const result = safeBuildSchema({ schema });
  expect(result.success).toBe(false);
  expect(result.error?.message).toBe(
    "Validation failed: Invalid type for ID column 'myTable.id'. Got 'many', expected one of ['string', 'hex', 'bigint', 'int'].",
  );
});

test("safeBuildSchema() returns error for ID column with the references modifier", () => {
  const schema = createSchema((p) => ({
    // @ts-expect-errora
    myTable: p.createTable({
      id: p.string().references("refTable.id"),
    }),
    refTable: p.createTable({
      id: p.string(),
    }),
  }));

  const result = safeBuildSchema({ schema });
  expect(result.success).toBe(false);
  expect(result.error?.message).toBe(
    "Validation failed: Invalid type for ID column 'myTable.id'. ID columns cannot use the '.references' modifier.",
  );
});

test("safeBuildSchema() returns error for invalid ID column type boolean", () => {
  const schema = createSchema((p) => ({
    // @ts-expect-error
    myTable: p.createTable({
      id: p.boolean(),
    }),
  }));

  const result = safeBuildSchema({ schema });
  expect(result.success).toBe(false);
  expect(result.error?.message).toBe(
    "Validation failed: Invalid type for ID column 'myTable.id'. Got 'boolean', expected one of ['string', 'hex', 'bigint', 'int'].",
  );
});

test("safeBuildSchema() returns error for invalid ID column type float", () => {
  const schema = createSchema((p) => ({
    // @ts-expect-error
    myTable: p.createTable({
      id: p.float(),
    }),
  }));

  const result = safeBuildSchema({ schema });
  expect(result.success).toBe(false);
  expect(result.error?.message).toBe(
    "Validation failed: Invalid type for ID column 'myTable.id'. Got 'float', expected one of ['string', 'hex', 'bigint', 'int'].",
  );
});

test("safeBuildSchema() returns error for ID column with optional modifier", () => {
  const schema = createSchema((p) => ({
    // @ts-expect-error
    myTable: p.createTable({
      id: p.string().optional(),
    }),
  }));

  const result = safeBuildSchema({ schema });
  expect(result.success).toBe(false);
  expect(result.error?.message).toBe(
    "Validation failed: Invalid type for ID column 'myTable.id'. ID columns cannot be optional.",
  );
});

test("safeBuildSchema() returns error for ID column with list modifier", () => {
  const schema = createSchema((p) => ({
    // @ts-expect-error
    myTable: p.createTable({
      id: p.string().list(),
    }),
  }));

  const result = safeBuildSchema({ schema });
  expect(result.success).toBe(false);
  expect(result.error?.message).toBe(
    "Validation failed: Invalid type for ID column 'myTable.id'. ID columns cannot be a list.",
  );
});

test("safeBuildSchema() returns error for empty table or enum name", () => {
  const schema = createSchema((p) => ({
    "": p.createEnum(["value1", "value2"]),
    myTable: p.createTable({
      id: p.string(),
    }),
  }));

  const result = safeBuildSchema({ schema });
  expect(result.success).toBe(false);
  expect(result.error?.message).toBe(
    "Validation failed: Enum name can't be an empty string.",
  );
});

test("safeBuildSchema() returns error for table or enum name with invalid characters", () => {
  const schema = createSchema((p) => ({
    "invalid-name": p.createEnum(["value1", "value2"]),
    myTable: p.createTable({
      id: p.string(),
    }),
  }));

  const result = safeBuildSchema({ schema });
  expect(result.success).toBe(false);
  expect(result.error?.message).toBe(
    "Validation failed: Enum name 'invalid-name' contains an invalid character.",
  );
});

test("safeBuildSchema() returns error for 'one' relationship with non-existent reference column", () => {
  const schema = createSchema((p) => ({
    // @ts-expect-error
    myTable: p.createTable({
      id: p.string(),
      refColumn: p.one("nonExistentColumn"),
    }),
  }));

  const result = safeBuildSchema({ schema });
  expect(result.success).toBe(false);
  expect(result.error?.message).toContain("uses a column that does not exist");
});

test("safeBuildSchema() returns error for 'one' relationship with reference to non-foreign key column", () => {
  const schema = createSchema((p) => ({
    myTable: p.createTable({
      id: p.string(),
      refColumn: p.one("nonForeignKeyColumn"),
      nonForeignKeyColumn: p.string(),
    }),
  }));

  const result = safeBuildSchema({ schema });
  expect(result.success).toBe(false);
  expect(result.error?.message).toContain(
    "uses a column that is not foreign key column",
  );
});

test("safeBuildSchema() returns error for 'many' relationship with non-existent reference table", () => {
  const schema = createSchema((p) => ({
    // @ts-expect-error
    myTable: p.createTable({
      id: p.string(),
      refColumn: p.many("nonExistentTable.nonExistentColumn"),
    }),
  }));

  const result = safeBuildSchema({ schema });
  expect(result.success).toBe(false);
  expect(result.error?.message).toContain("uses a table that does not exist");
});

test("safeBuildSchema() returns error for 'many' relationship with non-existent reference column", () => {
  const schema = createSchema((p) => ({
    // @ts-expect-error
    myTable: p.createTable({
      id: p.string(),
      refColumn: p.many("otherTable.nonExistentColumn"),
    }),
    otherTable: p.createTable({
      id: p.string(),
    }),
  }));

  const result = safeBuildSchema({ schema });
  expect(result.success).toBe(false);
  expect(result.error?.message).toContain("uses a column that does not exist");
});

test("safeBuildSchema() returns error for 'many' relationship with reference to non-foreign key column", () => {
  const schema = createSchema((p) => ({
    // @ts-expect-error
    myTable: p.createTable({
      id: p.string(),
      refColumn: p.many("otherTable.nonForeignKeyColumn"),
    }),
    otherTable: p.createTable({
      id: p.string(),
      nonForeignKeyColumn: p.string(),
    }),
  }));

  const result = safeBuildSchema({ schema });
  expect(result.success).toBe(false);
  expect(result.error?.message).toContain(
    "uses a column that is not foreign key column",
  );
});

test("safeBuildSchema() returns error for enum column referencing non-existent enum", () => {
  const schema = createSchema((p) => ({
    // @ts-expect-error
    myTable: p.createTable({
      id: p.string(),
      enumColumn: p.enum("nonExistentEnum"),
    }),
  }));

  const result = safeBuildSchema({ schema });
  expect(result.success).toBe(false);
  expect(result.error?.message).toContain("doesn't reference a valid enum");
});

test("safeBuildSchema() returns error for foreign key column referencing non-existent ID column", () => {
  const schema = createSchema((p) => ({
    // @ts-expect-error
    myTable: p.createTable({
      id: p.string(),
      fkColumn: p.string().references("nonExistentTable.id"),
    }),
  }));

  const result = safeBuildSchema({ schema });
  expect(result.success).toBe(false);
  expect(result.error?.message).toContain(
    "does not reference a valid ID column",
  );
});

test("safeBuildSchema() returns error for foreign key column type mismatch", () => {
  const schema = createSchema((p) => ({
    myTable: p.createTable({
      id: p.string(),
      fkColumn: p.bigint().references("otherTable.id"),
    }),
    otherTable: p.createTable({
      id: p.string(),
    }),
  }));

  const result = safeBuildSchema({ schema });
  expect(result.success).toBe(false);
  expect(result.error?.message).toContain(
    "type does not match the referenced table's ID column type",
  );
});
