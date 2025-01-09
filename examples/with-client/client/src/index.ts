import { createClient, desc, sum } from "@ponder/client";
import * as schema from "../../ponder/ponder.schema";

const client = createClient("http://localhost:42069", { schema });

const { unsubscribe } = client.live(
  (db) => db.select({ sum: sum(schema.account.balance) }).from(schema.account),
  (result) => {
    console.log(result);
  },
  (error) => {
    console.error(error);
  },
);

await new Promise((resolve) => setTimeout(resolve, 5_000));

unsubscribe();

// const result = await client.db
//   .select()
//   .from(schema.account)
//   .limit(3)
//   .orderBy(desc(schema.account.balaance))
//   .execute();

// console.log(result);
