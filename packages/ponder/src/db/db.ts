// import type { Database } from "better-sqlite3";
import SqliteDatabase from "better-sqlite3";

const db = SqliteDatabase(":memory:", { verbose: console.log });

// This is not great, but the only way I could figure out how to inject the _same_ sqlite db instance
// in the generated code was by attaching it to global like this.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
global.db = db;

// const upsert = ({
//   db,
//   tableName,
//   attributes,
// }: {
//   db: Database;
//   tableName: string;
//   attributes: { [key: string]: string | number };
// }) => {

//   const

//   const statement = `insert into \`${tableName}\` (${columnStatements
//     .map((s) => s.column)
//     .join(", ")}) values (${columnStatements
//     .map((s) => s.value)
//     .join(", ")}) on conflict(\`id\`)`;

//   db.prepare(statement).run();
// };

export { db };
