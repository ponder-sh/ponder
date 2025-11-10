import { createClient, desc } from "@ponder/client";
import * as schema from "../../ponder/ponder.schema";

const client = createClient("http://localhost:42069/sql", { schema });

const result = await client.db
  .select({ balance: schema.account.balance })
  .from(schema.account)
  .orderBy(desc(schema.account.balance))
  .limit(1);

console.log(result[0]);

console.log("Subscribing to live updates...");

const { unsubscribe } = client.live(
  (db) =>
    db
      .select({ balance: schema.account.balance })
      .from(schema.account)
      .orderBy(desc(schema.account.balance))
      .limit(1),
  (data) => {
    console.log(data[0]);
  },
  (error) => {
    console.error(error);
  },
);

setTimeout(() => {
  unsubscribe();
}, 10_000);
