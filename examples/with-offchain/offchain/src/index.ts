import { drizzle } from "drizzle-orm/node-postgres";
import { schema } from "./schema";

export const db = drizzle(process.env.DATABASE_URL!, { schema });

const result = await db.query.metadataTable.findMany({
  with: {
    token: true,
  },
});

console.log(result);
