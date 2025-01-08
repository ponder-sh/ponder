import { createClient, sum } from "@ponder/client";
import * as schema from "../../ponder/ponder.schema";

const client = createClient("http://localhost:42069", { schema });

const { unsubscribe } = client.live(
  (db) => db.select({ sum: sum(schema.account.balance) }).from(schema.account),
  (result) => {
    console.log(result);
  },
);

await new Promise((resolve) => setTimeout(resolve, 5_000));

unsubscribe();
