import type { DbSchema } from "./buildDbSchema";
import { db } from "./db";

type KnexColumnType = "string" | "boolean" | "integer";

const gqlToKnexTypeMap: { [gqlType: string]: KnexColumnType | undefined } = {
  ID: "integer",
  Boolean: "boolean",
  Int: "integer",
  String: "string",
};

let isInitialized = false;

const migrateDb = async (dbSchema: DbSchema) => {
  const { tables } = dbSchema;

  if (isInitialized) {
    return;
  }
  isInitialized = true;

  for (const table of tables) {
    await db.schema.createTable(table.name, (knexTable) => {
      // Add a column for each one specified in the table.
      for (const column of table.columns) {
        // Handle the ID field manually.
        if (column.type === "ID") {
          knexTable.increments();
          continue;
        }

        const knexColumnType = gqlToKnexTypeMap[column.type];
        if (!knexColumnType) {
          throw new Error(`Unhandled GQL type: ${column.type}`);
        }

        if (column.notNull) {
          knexTable[knexColumnType](column.name).notNullable();
        } else {
          knexTable[knexColumnType](column.name);
        }
      }

      knexTable.timestamps();
    });
  }

  return tables.length;
};

export { migrateDb };
