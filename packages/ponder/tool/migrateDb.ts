import type { DbSchema } from "./buildDbSchema";
import { db, getTableNames } from "./db";

type KnexColumnType = "string" | "boolean" | "integer";

const gqlToKnexTypeMap: { [gqlType: string]: KnexColumnType | undefined } = {
  ID: "integer",
  Boolean: "boolean",
  Int: "integer",
  String: "string",
};

let isInitialized = false;

const migrateDb = async (dbSchema: DbSchema) => {
  console.log("in migrateDb:", { isInitialized });

  if (isInitialized) {
    // Drop all tables if not running for the first time.
    await dropTables();
    console.log(`Detected database changes, dropping tables...`);
  } else {
    isInitialized = true;
  }

  await createTables(dbSchema);
  console.log(`Detected database changes, creating tables...`);
};

const dropTables = async () => {
  const tableNames = await getTableNames();

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
  });

  await Promise.all(createTablePromises);
};

export { migrateDb };
