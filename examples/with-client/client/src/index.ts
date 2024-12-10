import { createClient } from "@ponder/client";
import * as schema from "../../ponder/ponder.schema";

const client = createClient({ url: "http://localhost:42069/client", schema });

const response = await client.db
  //  ^?
  .select()
  .from(schema.account)
  .limit(10);

console.log({ response });
