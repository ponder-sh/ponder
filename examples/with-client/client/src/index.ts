import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../../ponder/ponder.schema";

const client = new pg.Client(process.env.DATABASE_URL);
await client.connect();
const db = drizzle(client, { schema, casing: "snake_case" });

const response = await db
  //  ^?
  .select()
  .from(schema.account)
  .where(
    eq(schema.account.address, "0xC1894e6a52c4C7Ac5b2e0b25583Ea48bf45DA14a"),
  );

console.log(response);
