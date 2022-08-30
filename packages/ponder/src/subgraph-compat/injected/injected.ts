// The purpose of this file is to generate a `injected.js` file in the user's repo at ~/project/.ponder/injected.js
// This file is injected while building the user's handlers.js file.

import { Entity, ValueKind } from "@ponder/graph-ts-ponder";

// The db gets injected into the global scope before handler functions start running.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
const db = global.db;

type GraphStore = {
  get: (entity: string, id: string) => Entity | null;
  set: (entity: string, id: string, data: Entity) => void;
  remove: (entity: string, id: string) => void;
};

const get = (entityName: string, id: string) => {
  console.log("in get with:", { entityName, id });

  const entity = db
    .prepare(`select * from \`${entityName}\` where id = '@id'`)
    .get({ id: id });
  console.log({ entity });

  if (!entity) {
    return null;
  }

  return entity;
};

const set = async (entityName: string, id: string, entity: Entity) => {
  console.log("in set with:", { entityName, id, entity });

  entity.entries.forEach((entry) => {
    console.log({ key: entry.key, value: entry.value });
  });

  const columnStatements = entity.entries.map((entry) => {
    switch (entry.value.kind) {
      case ValueKind.STRING: {
        return {
          column: `\`${entry.key}\``,
          value: `'${entry.value.data}'`,
        };
      }
      default: {
        throw new Error(`Unhandled value kind: ${entry.value.kind}`);
      }
    }
  });

  console.log({ columnStatements });

  const statement = `insert into \`${entityName}\` (${columnStatements
    .map((s) => s.column)
    .join(", ")}) values (${columnStatements
    .map((s) => s.value)
    .join(", ")}) on conflict(\`id\`)`;

  console.log({ statement });

  return;
};

const remove = (entityName: string, id: string) => {
  console.log("in remove with:", { entityName, id });

  return;
};

export const ponderInjectedStore: GraphStore = { get, set, remove };
