import { createClient, sum } from "@ponder/client";
import * as schema from "../../ponder/ponder.schema";

const client = createClient("http://localhost:42069/sql", { schema });

const result = await client.db
  .select({ sum: sum(schema.accountView.balance) })
  .from(schema.accountView);

console.log(result);

console.log("Subscribing to live updates...");

const { unsubscribe } = client.live(
  (db) => db.select({ sum: sum(schema.account.balance) }).from(schema.account),
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
