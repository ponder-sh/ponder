import { knex } from "knex";

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

db.on("query", (data) => {
  console.log("Executed query:");
  console.log("\x1b[36m%s\x1b[0m", data.sql, "\n");
});

export { db };
