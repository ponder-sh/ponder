import { createClient, desc } from "@ponder/client";
import * as schema from "../../ponder/ponder.schema";

const client = createClient("http://localhost:42069/sql", { schema });

const result = await client.db
  .select({ balance: schema.accountView.balance })
  .from(schema.accountView)
  .orderBy(desc(schema.accountView.balance))
  .limit(1);

console.log(result);

console.log("Subscribing to live updates...");

const { unsubscribe } = client.live(
  (db) =>
    db
      .select({ balance: schema.accountView.balance })
      .from(schema.accountView)
      .orderBy(desc(schema.accountView.balance))
      .limit(1),
  (data) => {
    console.log(data);
  },
  (error) => {
    console.error(error);
  },
);

setTimeout(() => {
  unsubscribe();
}, 10_000);
