import { createClient, desc } from "@ponder/client";
import { getPonderQueryOptions } from "@ponder/react";
import * as schema from "../../ponder/ponder.schema";

const client = createClient(
  process.env.NODE_ENV === "development"
    ? "http://localhost:42069/sql"
    : "https://api.ponder.dev/sql",
  { schema },
);

const depositsQueryOptions = getPonderQueryOptions(client, (db) =>
  db
    .select()
    .from(schema.depositEvent)
    .orderBy(desc(schema.depositEvent.timestamp))
    .limit(10),
);

type Deposits = Awaited<ReturnType<typeof depositsQueryOptions.queryFn>>;

export { client, schema, depositsQueryOptions, type Deposits };
