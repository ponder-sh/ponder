import SqliteDatabase from "better-sqlite3";

const db = SqliteDatabase(":memory:", {
  // verbose: console.log,
});

export { db };
