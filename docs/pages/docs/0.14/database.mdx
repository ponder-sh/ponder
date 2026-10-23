# Database [Set up the database]

Ponder supports two database options, [**PGlite**](https://pglite.dev/) and Postgres.

- **PGlite**: An embedded Postgres database. PGlite runs in the same Node.js process as Ponder, and stores data in the `.ponder` directory. **Only suitable for local development**.
- **PostgreSQL**: A traditional Postgres database server. Required for production, can be used for local development.

## Choose a database

Ponder uses PGlite by default. To use Postgres, set the `DATABASE_URL` environment variable to a Postgres connection string, or use explicit configuration in `ponder.config.ts`.

```ts
import { createConfig } from "ponder";

export default createConfig({
  database: { // [!code focus]
    kind: "postgres", // [!code focus]
    connectionString: "postgresql://user:password@localhost:5432/dbname", // [!code focus]
  }, // [!code focus]
  // ...
});
```

[Read more](/docs/api-reference/ponder/config#database) about database configuration in the `ponder.config.ts` API reference.

## Database schema

Ponder uses **database schemas** to organize data. Each instance must use a different schema.

Use the `DATABASE_SCHEMA` environment variable or `--schema` CLI option to configure the database schema for an instance. This is where the app will create the tables defined in `ponder.schema.ts`.

:::code-group

```bash [.env.local]
DATABASE_SCHEMA=my_schema
```

```bash [CLI]
ponder start --schema my_schema
```

:::

[Read more](/docs/production/self-hosting#database-schema) about database schema selection in the self-hosting guide.

### Guidelines

Here are a few things to keep in mind when choosing a database schema.

- No two Ponder instances/deployments can use the same database schema at the same time.
- Tables created by `ponder start` are treated as valuable and will never be dropped automatically.
- The default schema for `ponder dev` is `public`. There is no default for `ponder start`, you must explicitly set the database schema.
- Use `ponder dev` for local development; `ponder start` is intended for production.
