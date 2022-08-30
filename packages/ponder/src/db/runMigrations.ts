import { Kind } from "graphql";

import type { DbSchema } from "../db/buildDbSchema";
import { db } from "./db";

const getTableNames = () => {
  return db
    .prepare("select name from sqlite_master where type='table'")
    .all()
    .filter((table) => table.name !== "sqlite_sequence")
    .map((table) => table.name as string);
};

const gqlScalarToSqlTypeMap: Record<string, string | undefined> = {
  ID: "integer",
  Boolean: "boolean",
  Int: "integer",
  String: "text",
  // graph-ts scalar types
  BigInt: "text",
  BigDecimal: "text",
  Bytes: "text",
};

let isInitialized = false;

const runMigrations = async (dbSchema: DbSchema) => {
  if (isInitialized) {
    // Drop all tables if not running for the first time.
    dropTables();
  } else {
    isInitialized = true;
  }

  createTables(dbSchema);
};

const dropTables = async () => {
  const tableNames = getTableNames();

  tableNames.forEach((tableName) => {
    db.prepare(`drop table if exists \`${tableName}\``).run();
  });
};

const createTables = (dbSchema: DbSchema) => {
  const { tables } = dbSchema;

  const tableStatements = tables.map((table) => {
    // Add a column for each one specified in the table.
    const columnStatements = table.columns.map((column) => {
      // Handle the ID field.
      if (column.type === "ID") {
        return `id text not null primary key`;
      }

      // Handle enums, lists, and relationships.
      const userDefinedType = dbSchema.userDefinedTypes[column.type];
      if (userDefinedType) {
        // Handle enum types.
        if (userDefinedType.astNode?.kind == Kind.ENUM_TYPE_DEFINITION) {
          if (!userDefinedType.astNode.values) {
            throw new Error(`Values not present on GQL Enum: ${column.name}`);
          }

          const enumValues = userDefinedType.astNode.values.map(
            (v) => v.name.value
          );

          let statement = `\`${column.name}\` text check (\`${
            column.name
          }\` in (${enumValues.map((v) => `'${v}'`).join(", ")}))`;

          if (column.notNull) {
            statement += " not null";
          }

          return statement;
        }

        // Handle list types.
        // else if (
        //   userDefinedType.astNode?.kind == Kind.LIST ?????
        // ) {
        //   // Handling list!
        //   throw new Error(`Unsupported GQL type: ${column.type}`);
        // }
      }

      // Handle scalars.
      const sqlColumnType = gqlScalarToSqlTypeMap[column.type];
      if (sqlColumnType) {
        let statement = `\`${column.name}\` ${sqlColumnType}`;
        if (column.notNull) {
          statement += " not null";
        }

        return statement;
      }

      // Throw because the type was not handled by any paths above.
      throw new Error(`Unhandled GQL type: ${column.type}`);
    });

    columnStatements.push(`\`createdAt\` datetime`, `\`updatedAt\` datetime`);

    return `create table \`${table.name}\` (${columnStatements.join(", ")})`;
  });

  tableStatements.forEach((tableStatement) => {
    db.prepare(tableStatement).run();
  });
};

export { runMigrations };
