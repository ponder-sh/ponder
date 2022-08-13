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
  if (data.bindings && data.bindings.length > 0) {
    console.log("\x1b[36m%s\x1b[0m", data.sql); // cyan
    console.log("\x1b[32m%s\x1b[0m", data.bindings, "\n"); // green
  } else {
    console.log("\x1b[36m%s\x1b[0m", data.sql, "\n"); // cyan
  }
});

export { db };
