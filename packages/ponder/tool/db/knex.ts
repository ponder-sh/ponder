import { knex } from "knex";
import knexSchemaInspector from "knex-schema-inspector";

const db = knex({
  client: "sqlite3",
  connection: {
    filename: ":memory:",
  },
  migrations: {
    tableName: "knex_migrations",
  },
  useNullAsDefault: true,
});

const inspector = knexSchemaInspector(db);

db.on("query", (data) => {
  if (data.bindings && data.bindings.length > 0) {
    console.log(
      `\x1b[33m${"QUERY"}\x1b[0m`, // yellow
      `\x1b[36m${data.sql}\x1b[0m` // cyan
    );
    console.log(
      `\x1b[32m${JSON.stringify(data.bindings)}\x1b[0m`, // green
      "\n"
    );
  } else {
    console.log(
      `\x1b[33m${"QUERY"}\x1b[0m`, // yellow
      `\x1b[36m${data.sql}\x1b[0m`, // cyan
      "\n"
    );
  }
});

const getTableNames = async () => {
  const tables = await inspector.tables();
  return tables;
};

export { db, getTableNames };
