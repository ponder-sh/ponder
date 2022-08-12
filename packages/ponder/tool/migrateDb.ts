import { db } from "./db";
import { processSchema } from "./processSchema";

type KnexColumnType = "string" | "boolean" | "integer";

const gqlToKnexTypeMap: { [gqlType: string]: KnexColumnType | undefined } = {
  ID: "integer",
  Boolean: "boolean",
  Int: "integer",
  String: "string",
};

const migrateDb = async () => {
  const dbDefinition = await processSchema();

  for (const tableDefinition of dbDefinition) {
    await db.schema.createTable(tableDefinition.tableName, (table) => {
      // Add a column for each one specified in the tableDefinition.
      for (const columnDefinition of tableDefinition.columnDefinitions) {
        // Handle the ID field manually.
        if (columnDefinition.type === "ID") {
          table.increments();
          continue;
        }

        const knexColumnType = gqlToKnexTypeMap[columnDefinition.type];
        if (!knexColumnType) {
          throw new Error(`Unhandled GQL type: ${columnDefinition.type}`);
        }

        if (columnDefinition.notNull) {
          table[knexColumnType](columnDefinition.columnName).notNullable();
        } else {
          table[knexColumnType](columnDefinition.columnName);
        }
      }

      table.timestamps();
    });
  }

  return dbDefinition.length;
};

export { migrateDb };
