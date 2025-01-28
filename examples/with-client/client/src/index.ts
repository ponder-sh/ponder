import { createClient, sum } from "@ponder/client";
import * as schema from "../../ponder/ponder.schema";

const client = createClient("http://localhost:42069/sql", { schema });

const result = await client.db
  .select({ sum: sum(schema.account.balance) })
  .from(schema.account)
  .execute();

console.log(result);
