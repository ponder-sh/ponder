// TODO: Figure out where this goes!

// const getTableNames = () => {
//   return db
//     .prepare("select name from sqlite_master where type='table'")
//     .all()
//     .filter((table) => table.name !== "sqlite_sequence")
//     .map((table) => table.name as string);
// };

// let isInitialized = false;

// const runMigrations = async (schema: Schema) => {
//   if (isInitialized) {
//     // Drop all tables if not running for the first time.
//     dropTables();
//   } else {
//     isInitialized = true;
//   }

//   createTables(schema);
// };

// const dropTables = async () => {
//   const tableNames = getTableNames();

//   tableNames.forEach((tableName) => {
//     db.prepare(`drop table if exists \`${tableName}\``).run();
//   });
// };

// const createTables = (schema: Schema) => {
//   const entities = Object.values(schema.entities);

//   const tableStatements = entities.map((entity) => {
//     // Add a column for each one specified in the table.
//     const columnStatements = entity.fields.map(
//       (field) => field.migrateUpStatement
//     );

//     columnStatements.push(`\`createdAt\` datetime`, `\`updatedAt\` datetime`);

//     return `create table \`${entity.name}\` (${columnStatements.join(", ")})`;
//   });

//   tableStatements.forEach((tableStatement) => {
//     db.prepare(tableStatement).run();
//   });
// };

// export { runMigrations };
