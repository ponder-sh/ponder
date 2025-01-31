import { createClient, desc } from "@ponder/client";
import { getPonderQueryOptions } from "@ponder/react";
import * as schema from "../../ponder/ponder.schema";

const client = createClient("http://localhost:42069/sql", { schema });

const depositsQueryOptions = getPonderQueryOptions(client, (db) =>
  db
    .select()
    .from(schema.depositEvent)
    .orderBy(desc(schema.depositEvent.timestamp))
    .limit(10),
);

type Deposits = Awaited<ReturnType<typeof depositsQueryOptions.queryFn>>;

export { client, schema, depositsQueryOptions, type Deposits };
