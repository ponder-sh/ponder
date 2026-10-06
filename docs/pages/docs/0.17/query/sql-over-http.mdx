# SQL over HTTP [Query with custom SQL over HTTP]

Ponder natively supports SQL queries over HTTP using the `@ponder/client` and `@ponder/react` packages.

The SQL over HTTP is a more powerful alternative to [GraphQL](/docs/query/graphql) that offers zero-codegen type inference, live queries, and the flexibility of SQL directly in your client code.

## Setup

::::steps

### Enable on the server

Use the `client` Hono middleware to enable SQL over HTTP queries.

```ts [src/api/index.ts]
import { db } from "ponder:api";
import schema from "ponder:schema";
import { Hono } from "hono";
import { client } from "ponder"; // [!code focus]

const app = new Hono();

app.use("/sql/*", client({ db, schema })); // [!code focus]

export default app;
```

### Install `@ponder/client`

Install the `@ponder/client` package in your client project.

:::code-group

```bash [pnpm]
pnpm add @ponder/client
```

```bash [yarn]
yarn add @ponder/client
```

```bash [npm]
npm add @ponder/client
```

```bash [bun]
bun add @ponder/client
```

:::

### Create a query client

Use `createClient` to connect to the server at the path where you registered the middleware.

```ts [Client project]
import { createClient } from "@ponder/client";

const client = createClient("http://localhost:42069/sql");
```

### Import `ponder.schema.ts`

Import your schema from `ponder.schema.ts` and pass it to `createClient`. [Read more](#use-schema-from-a-different-repo) about schema portability.

```ts [Client project]
import { createClient } from "@ponder/client";
import * as schema from "../../ponder/ponder.schema"; // [!code focus]

const client = createClient("http://localhost:42069/sql", { schema }); // [!code focus]
```

Now, the client is ready to send SQL over HTTP queries to the server.

```ts [Client project]
import { createClient } from "@ponder/client";
import * as schema from "../../ponder/ponder.schema";

const client = createClient("http://localhost:42069/sql", { schema });

const result = await client.db.select().from(schema.account); // [!code focus]
//   ^? { address: `0x${string}`; balance: bigint; }[] // [!code focus]
```

::::

## Setup React

The `@ponder/react` package provides React hook bindings for the SQL over HTTP client. This package wraps [TanStack Query](https://tanstack.com/query), a popular library for managing async state in React.

::::steps

### Install dependencies

Install `@ponder/react` and peer dependencies in your client project.

:::code-group

```bash [pnpm]
pnpm add @ponder/react @ponder/client @tanstack/react-query
```

```bash [yarn]
yarn add @ponder/react @ponder/client @tanstack/react-query
```

```bash [npm]
npm add @ponder/react @ponder/client @tanstack/react-query
```

```bash [bun]
bun add @ponder/react @ponder/client @tanstack/react-query
```

:::

### Set up `@ponder/client`

Follow the [steps above](#guide) to set up a SQL over HTTP query client using `@ponder/client`.

```ts [lib/ponder.ts]
import { createClient } from "@ponder/client";
import * as schema from "../../ponder/ponder.schema"; // [!code focus]

const client = createClient("http://localhost:42069/sql", { schema }); // [!code focus]
```

### Set up `PonderProvider`

Wrap your app with `PonderProvider` and include the `client` object you created in the previous step.

```ts [app/layout.tsx]
import { PonderProvider } from "@ponder/react";
import { client } from "../lib/ponder";
 
function App() {
  return (
    <PonderProvider client={client}>
      {/** ... */}
    </PonderProvider>
  );
}
```

### Set up TanStack Query

Inside the `PonderProvider`, wrap your app with a TanStack Query Provider. If you're already using TanStack Query, you can skip this step. [Read more](https://tanstack.com/query/latest/docs/framework/react/quick-start) about setting up TanStack Query.

```ts [app/layout.tsx]
import { PonderProvider } from "@ponder/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"; // [!code focus]
import { client } from "../lib/ponder";
 
const queryClient = new QueryClient(); // [!code focus]
 
function App() {
  return (
    <PonderProvider client={client}>
      <QueryClientProvider client={queryClient}> // [!code focus]
        {/** ... */}
      </QueryClientProvider> // [!code focus]
    </PonderProvider>
  );
}
```

::::

## Querying

The SQL over HTTP client can be used to read indexed data from your Ponder database.

It's different than [direct SQL](/docs/query/direct-sql) in two key areas:
- Schema names are automatically applied on the server using Postgres's [`search_path`](https://www.postgresql.org/docs/current/ddl-schemas.html#DDL-SCHEMAS-PATH). Table names should be unqualified.
- Only a subset of SQL statements are allowed, with limited resources. Read more about [security](#security).

:::code-group

```ts [index.ts Node.js] 
import { desc } from "@ponder/client";
import * as schema from "../../ponder/ponder.schema";

const result = await client.db
  .select()
  .from(schema.account)
  .orderBy(desc(schema.account.balance));
```

```ts [index.ts React]
import { desc } from "@ponder/client";
import { usePonderQuery } from "@ponder/react";
import * as schema from "../../ponder/ponder.schema";

const query = usePonderQuery({
  queryFn: (db) =>
    db.select().from(schema.account).orderBy(desc(schema.account.balance)),
});
```

:::

:::tip
The `@ponder/client` package re-exports all Drizzle utility functions (like `desc` and `eq`). You shouldn't need to install `drizzle-orm` separately.
:::

### Live queries

Live queries are automatically updated when the underlying data changes. Ponder uses Server-Sent Events to stream updates to the **only when the query result changes**.

:::code-group

```ts [index.ts Node.js] 
import { desc } from "@ponder/client";
import * as schema from "../../ponder/ponder.schema";

await client.live(
  (db) => 
    db.select().from(schema.account).orderBy(desc(schema.account.balance)),
  (result) => {
    // ... handle result
  },
  (error) => {
    // ... handle error
  },
);
```

```ts [index.ts React]
import { desc } from "@ponder/client";
import { usePonderQuery } from "@ponder/react";
import * as schema from "../../ponder/ponder.schema";

// `usePonderQuery` always uses live queries!
const query = usePonderQuery({
  queryFn: (db) =>
    db.select().from(schema.account).orderBy(desc(schema.account.balance)),
});
```

:::

### Untyped queries

It's also possible to query the Ponder database without relying on importing `ponder.schema.ts` using the [`sql`](https://orm.drizzle.team/docs/sql) operator.

:::code-group

```ts [index.ts Node.js] 
import { sql } from "@ponder/client";

const result = await client.db.execute(sql`SELECT * FROM account limit 10;`);
```

```ts [index.ts React]
import { sql } from "@ponder/client";
import { usePonderQuery } from "@ponder/react";

const query = usePonderQuery({
  queryFn: (db) => db.execute(sql`SELECT * FROM account limit 10;`),
});
```

:::

### Pagination

The SQL over HTTP supports both limit/offset and cursor-based pagination patterns to handle large result sets efficiently.

:::code-group

```ts [index.ts Node.js] 
import { desc } from "@ponder/client";
import * as schema from "../../ponder/ponder.schema";

const count = await client.db.$count(schema.account);

const result = await client.db
  .select()
  .from(schema.account)
  .orderBy(desc(schema.account.balance))
  .limit(100)
  .offset(500);
```

```ts [index.ts React]
import { desc } from "@ponder/client";
import { usePonderQuery } from "@ponder/react";
import * as schema from "../../ponder/ponder.schema";

const countQuery = usePonderQuery({
  queryFn: (db) => db.$count(schema.account),
});

const query = usePonderQuery({
  queryFn: (db) =>
    db
      .select()
      .from(schema.account)
      .orderBy(desc(schema.account.balance))
      .limit(100)
      .offset(500),
});
```

:::

### Relational query builder

The SQL over HTTP also supports the [Drizzle query builder](https://orm.drizzle.team/docs/rqb) with some additional setup required.

The `createClient` function accepts a `schema` option to enable the Drizzle query builder.

```ts 
import { createClient } from "@ponder/client";
import * as schema from "../../ponder/ponder.schema";

const client = createClient("http://localhost:42069/sql", { schema });

const result = await client.db.query.account.findMany({
  orderBy: (account, { desc }) => desc(account.balance),
});
```

#### React

In addition to the step above, you need to "register" your `schema` globally with TypeScript using [declaration merging](https://www.typescriptlang.org/docs/handbook/declaration-merging.html).

```ts
import * as schema from "../../ponder/ponder.schema";

declare module "@ponder/react" { // [!code focus]
  interface Register { // [!code focus]
    schema: typeof schema; // [!code focus]
  } // [!code focus]
} // [!code focus]
```

`usePonderQuery` is now type-safe without the need to import `schema` in every query.

```ts
import { usePonderQuery } from "@ponder/react";

const query = usePonderQuery({
  queryFn: (db) =>
    db.query.account.findMany({
      orderBy: (account, { desc }) => desc(account.balance),
    }),
});
```

## Examples

- [Basic usage](https://github.com/ponder-sh/ponder/blob/main/examples/with-client/client/src/index.ts) (`@ponder/client` only)
- [Usage with Next.js](https://github.com/ponder-sh/ponder/blob/main/examples/with-nextjs/frontend/src/pages/index.ts#L11-L18) (`@ponder/client` and `@ponder/react`)
- Usage with [`useInfiniteQuery`](https://tanstack.com/query/latest/docs/framework/react/guides/infinite-queries)

For this example, we'll use the following schema.

```ts [ponder.schema.ts]
import { onchainTable } from "ponder";

export const person = onchainTable("person", (t) => ({
  id: t.integer().primaryKey(),
  name: t.text().notNull(),
  age: t.integer(),
}));
```

Get all `person` records with an `age` greater than `32`.

```ts 
import { asc, gt } from "@ponder/client";
import { usePonderClient } from "@ponder/react";
import { useInfiniteQuery } from "@tanstack/react-query";

const client = usePonderClient();

const personQuery = useInfiniteQuery({
  queryKey: ["persons"],
  queryFn: ({ pageParam }) =>
    client.db
      .select()
      .from(schema.person)
      .where(gt(schema.person.age, 32))
      .orderBy(asc(schema.person.id))
      .limit(100)
      .offset(pageParam),
  initialPageParam: 0,
  getNextPageParam: (lastPage, pages) =>
    lastPage.length === 100
      ? undefined
      : pages.length * 100,
});
```

- [Uniswap v4](https://github.com/marktoda/v4-ponder)

For this example, we'll use the following schema.

```ts [ponder.schema.ts]
import { index, relations, primaryKey, onchainTable } from "ponder";

export const token = onchainTable("token", (t) => ({
  address: t.hex().notNull(),
  chainId: t.integer().notNull(),
  name: t.text().notNull(),
  symbol: t.text().notNull(),
  decimals: t.integer().notNull(),
  creationBlock: t.integer().notNull(),
}),
  (table) => ({
    pk: primaryKey({ columns: [table.address, table.chainId] }),
    addressIndex: index().on(table.address),
    chainIdIndex: index().on(table.chainId),
  })
);

export const tokenRelations = relations(token, ({ many }) => ({
  pools: many(pool),
}));

export const pool = onchainTable("pool", (t) => ({
  poolId: t.hex().notNull(),
  currency0: t.hex().notNull(),
  currency1: t.hex().notNull(),
  fee: t.integer().notNull(),
  tickSpacing: t.integer().notNull(),
  hooks: t.hex().notNull(),
  chainId: t.integer().notNull(),
  creationBlock: t.integer().notNull(),
}),
  (table) => ({
    pk: primaryKey({ columns: [table.poolId, table.chainId] }),
    poolIdIndex: index().on(table.poolId),
    chainIdIndex: index().on(table.chainId),
  })
);

export const poolRelations = relations(pool, ({ many, one }) => ({
  token0: one(token, { fields: [pool.currency0, pool.chainId], references: [token.address, token.chainId] }),
  token1: one(token, { fields: [pool.currency1, pool.chainId], references: [token.address, token.chainId] }),
}));
```

Get all `pool` records with a `chainId` of `1` and a `fee` of `0` and include the `token0` and `token1` data.

```ts
import { usePonderQuery } from "@ponder/react";

const query = usePonderQuery({
  queryFn: (db) =>
    qb.query.pool.findMany({
      where: (pool, { and, eq }) => and(eq(pool.chainId, 1), eq(pool.fee, 0)),
      orderBy: (pool, { desc }) => desc(pool.creationBlock),
      with: {
        token0: true,
        token1: true,
      },
    }),
});
```

## Frequently asked questions

### Use schema from a different repo

The `@ponder/client` package needs the `onchainTable` objects exported by `ponder.schema.ts` to properly compile the Drizzle queries client-side.

If the client project is in a different repo from the Ponder project, there are a few other options:

- Import the `ponder.schema.ts` locally using a monorepo.
- Publish the `ponder.schema.ts` to npm.
- Copy the `ponder.schema.ts` into the client project and install `ponder` to get access to the `onchainTable` function.
- Forfeit type safety and use [untyped queries](#untyped-queries).

### Security

Here are the measures taken by the `client` middleware to prevent malicious queries & denial-of-service attacks. These measures aim to achieve a similar level of risk as the GraphQL API.

- **Read-only**: Each query statement runs in a `READ ONLY` transaction using autocommit.
- **Query validator**: Each query is parsed using [`libpg_query`](https://github.com/pganalyze/libpg_query) and must pass the following checks.

  - The query AST root must be a `SELECT{:sql}` statement. Queries containing multiple statements are rejected.
  - The query must only contain allowed AST node types and built-in SQL functions. For example, `SELECT{:sql}`, `WHERE{:sql}`, and `max(){:sql}` are allowed, but `DELETE{:sql}`, `SET{:sql}`, and `pg_advisory_lock(){:sql}` are not. [Read more](https://github.com/ponder-sh/ponder/blob/main/packages/core/src/client/validate.ts).
  - The query must not reference objects in schemas other than the current schema. [Read more](/docs/database#database-schema).

- **Resource limits**: The database session uses the following resource limit settings.
  <div className="h-2" />
  ```sql
  SET work_mem = '512MB';
  SET statement_timeout = '500ms';
  SET lock_timeout = '500ms';
  ```
