import { db } from "./db";

// const get = (entityName: string, id: string) => {
//   const entity = db
//     .prepare(`select * from \`${entityName}\` where id = '@id'`)
//     .get({ id: id });

//   if (!entity) {
//     return null;
//   }

//   return entity;
// };

// const set = async (entityName: string, id: string, entity: any) => {
//   const columnStatements = entity.entries.map((entry) => {
//     switch (entry.value.kind) {
//       case ValueKind.STRING: {
//         return {
//           column: `\`${entry.key}\``,
//           value: `'${entry.value.data}'`,
//         };
//       }
//       case ValueKind.INT: {
//         return {
//           column: `\`${entry.key}\``,
//           value: `${entry.value.data}`,
//         };
//       }
//       case ValueKind.BIGDECIMAL: {
//         return {
//           column: `\`${entry.key}\``,
//           value: `${entry.value.data}`,
//         };
//       }
//       case ValueKind.BOOL: {
//         return {
//           column: `\`${entry.key}\``,
//           value: `${entry.value.data ? "true" : "false"}`,
//         };
//       }
//       case ValueKind.ARRAY: {
//         throw new Error(`Unhandled ValueKind: ARRAY`);
//       }
//       case ValueKind.NULL: {
//         return {
//           column: `\`${entry.key}\``,
//           value: `null`,
//         };
//       }
//       case ValueKind.BYTES: {
//         return {
//           column: `\`${entry.key}\``,
//           value: `'${entry.value.data?.toString()}'`,
//         };
//       }
//       case ValueKind.BIGINT: {
//         return {
//           column: `\`${entry.key}\``,
//           value: `'${entry.value.data?.toString()}'`,
//         };
//       }
//     }
//   });

//   const insertFragment = `(${columnStatements
//     .map((s) => s.column)
//     .join(", ")}) values (${columnStatements.map((s) => s.value).join(", ")})`;

//   const updateFragment = columnStatements
//     .filter((s) => s.column !== "id")
//     .map((s) => `${s.column}=excluded.${s.column}`)
//     .join(", ");

//   // TODO: This is blatantly vulnerable to SQL injection attacks, try to mitigate.
//   const statement = `insert into \`${entityName}\` ${insertFragment} on conflict(\`id\`) do update set ${updateFragment}`;

//   db.prepare(statement).run();
// };

// const remove = (entityName: string, id: string) => {
//   const statement = `delete from \`${entityName}\` where \`id\` = '@id'`;

//   db.prepare(statement).run({ id: id });
// };
