import { Kind } from "graphql";

import type { DbSchema } from "./buildDbSchema";
import { db, getTableNames } from "./knex";

type KnexColumnType = "string" | "boolean" | "integer";

const gqlScalarToKnexTypeMap: {
  [gqlType: string]: KnexColumnType | undefined;
} = {
  ID: "integer",
  Boolean: "boolean",
  Int: "integer",
  String: "string",
  // graph-ts scalar types
  BigInt: "string",
  BigDecimal: "string",
  Bytes: "string",
};

let isInitialized = false;

const createOrUpdateDbTables = async (dbSchema: DbSchema) => {
  if (isInitialized) {
    // Drop all tables if not running for the first time.
    await dropTables();
  } else {
    isInitialized = true;
  }

  await createTables(dbSchema);
};

const dropTables = async () => {
  const tableNames = await getTableNames(db);

  const dropTablePromises = tableNames.map(async (tableName) => {
    await db.schema.dropTableIfExists(tableName);
  });

  await Promise.all(dropTablePromises);
};

const createTables = async (dbSchema: DbSchema) => {
  const { tables } = dbSchema;

  const createTablePromises = tables.map(async (table) => {
    await db.schema.createTable(table.name, (knexTable) => {
      // Add a column for each one specified in the table.
      table.columns.forEach((column) => {
        // Handle the ID field.
        if (column.type === "ID") {
          knexTable.increments();
          return;
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

            if (column.notNull) {
              knexTable.enu(column.name, enumValues).notNullable();
            } else {
              knexTable.enu(column.name, enumValues);
            }

            return;
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
        const knexColumnType = gqlScalarToKnexTypeMap[column.type];
        if (knexColumnType) {
          if (column.notNull) {
            knexTable[knexColumnType](column.name).notNullable();
          } else {
            knexTable[knexColumnType](column.name);
          }
          return;
        }

        // Throw because the type was not handled by any paths above.
        throw new Error(`Unhandled GQL type: ${column.type}`);
      });

      knexTable.timestamps();
    });
  });

  await Promise.all(createTablePromises);
};

export { createOrUpdateDbTables };
