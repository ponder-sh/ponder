// The purpose of this file is to generate a `injected.js` file in the user's repo at ~/project/.ponder/injected.js
// This file is injected while building the user's handlers.js file.

import { db } from "../../db/knex";

type GraphStore = {
  get: (entity: string, id: string) => any | null;
  set: (entity: string, id: string, data: any) => void;
  remove: (entity: string, id: string) => void;
};

// const db = buildDb();

const get = (entityName: string, id: string) => {
  console.log("in get with:", { entityName, id });
  // const record = db(entityName).first({ id: id });

  return null;
};

const set = (entityName: string, id: string, data: any) => {
  console.log("in set with:", { entityName, id, data });

  data.entries.forEach((entry: any) => {
    console.log({ key: entry.key, value: entry.value });
  });

  return;
};

const remove = (entityName: string, id: string) => {
  console.log("in remove with:", { entityName, id });

  return;
};

export const ponderInjectedStore: GraphStore = { get, set, remove };
