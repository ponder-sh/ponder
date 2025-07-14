# Offchain data [Combine onchain and offchain data]

Ponder supports querying onchain data (Ponder-managed tables) alongside offchain data (other tables in the same PostgreSQL database) using Drizzle.

:::info
  Ponder does not support reading or writing offchain data within indexing functions. This guide only applies to read-only SQL queries from custom API endpoints or standalone Node.js code.
:::

## Setup

::::steps

### Define the Ponder schema

Create a `ponder.schema.ts` file in your Ponder project. No special configuration is required.

```ts [ponder.schema.ts]
import { onchainTable } from "ponder";

export const account = onchainTable("account", (t) => ({
  address: t.hex().primaryKey(),
}));

export const token = onchainTable("token", (t) => ({
  id: t.bigint().primaryKey(),
  owner: t.hex().notNull(),
}));

export const transferEvent = onchainTable("transfer_event", (t) => ({
  id: t.text().primaryKey(),
  timestamp: t.integer().notNull(),
  from: t.hex().notNull(),
  to: t.hex().notNull(),
  token: t.bigint().notNull(),
}));
```

### Define the offchain schema

Next, create a schema definition file for the offchain data using Drizzle ([docs](https://orm.drizzle.team/docs/sql-schema-declaration#example)).

```ts [offchain.ts]
import { json, numeric, pgSchema } from "drizzle-orm/pg-core";

export const offchainSchema = pgSchema("offchain");

export const metadataTable = offchainSchema.table("metadata", {
  tokenId: numeric({ precision: 78, scale: 0 }).primaryKey(),
  metadata: json(),
});
```

:::info
  Be sure to use the same `drizzle-orm` version that your installed version of `ponder` uses. At time of writing, this is `drizzle-orm@0.41.0`.
:::

### Combine the schemas

In a separate file, combine the onchain and offchain schemas. You can also define Drizzle relations that connect tables across the two schemas.

```ts [schema.ts]
import { setDatabaseSchema } from "@ponder/client";
import { relations } from "drizzle-orm";
import * as ponderSchema from "./ponder.schema";
import * as offchainSchema from "./offchain";

setDatabaseSchema(ponderSchema, "prod");

export const metadataRelations = relations(
  offchainSchema.metadataTable,
  ({ one }) => ({
    token: one(ponderSchema.token, {
      fields: [offchainSchema.metadataTable.tokenId],
      references: [ponderSchema.token.id],
    }),
  }),
);

export const schema = {
  ...offchainSchema,
  ...ponderSchema,
  metadataRelations,
};
```

:::info
  Set the _database schema_ for Ponder tables and enums explicitly using `setDatabaseSchema`. To avoid having to update the schema name for each deployment, use the [views pattern](/docs/production/self-hosting#views-pattern).
:::

::::

## Query

### From Node.js

Once you've defined the combined schema, you can start writing queries from any Node.js code.

```ts [index.ts]
import { drizzle } from "drizzle-orm/node-postgres";
import { schema } from "./schema";

export const db = drizzle(process.env.DATABASE_URL!, { schema });

const result = await db.query.metadataTable.findMany({
  with: {
    token: true,
  },
});

console.log(result);
```

### From Ponder API endpoints

It's also possible to query offchain (or combined) data directly from custom API endpoints.

```ts [api/index.ts]
import { Hono } from "hono";
import { db } from "ponder:api";
import * as offchainSchema from "../../offchain";

const app = new Hono();

app.post("/new-metadata", async (c) => {
  const { tokenId, metadata } = await c.req.json();
  await db.insert(offchainSchema.metadataTable).values({
    tokenId,
    metadata,
  });
});

export default app;
```