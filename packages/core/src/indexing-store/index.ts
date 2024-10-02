import type { Database } from "@/database/index.js";
import type { Schema } from "@/drizzle/index.js";
import type { Db } from "@/types/db.js";
import { type SQL, type Table, and, eq } from "drizzle-orm";

export type IndexingStore = Db<Schema>;

const getKeyConditional = (table: Table, key: Object): SQL<unknown> => {
  // @ts-ignore
  return and(
    // @ts-ignore
    ...Object.entries(key).map(([column, value]) => eq(table[column], value)),
  );
};

export const createIndexingStore = ({
  database,
}: { database: Database }): IndexingStore => {
  return {
    // @ts-ignore
    find(table, key) {
      return database.drizzle
        .select()
        .from(table)
        .where(getKeyConditional(table, key))
        .then((res) => (res.length === 0 ? undefined : res[0]));
    },
    // @ts-ignore
    insert(table) {
      return {
        values: async (values: any) => {
          await database.drizzle.insert(table).values(values);
        },
      };
    },
    // @ts-ignore
    update(table, key) {
      return {
        set: async (values: any) => {
          await database.drizzle
            .update(table)
            .set(values)
            .where(getKeyConditional(table, key));
        },
      };
    },
    // @ts-ignore
    async delete(table, key) {
      await database.drizzle.delete(table).where(getKeyConditional(table, key));
    },
    raw: database.drizzle,
  };
};
