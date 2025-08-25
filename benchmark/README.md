# Benchmarks

## Usage

### Setup environment

Create an `env.local` file using `.env.example` as a template. The `DATABASE_URL` should not include a database (i.e. `postgres://kylescott@localhost:5432`).

Create the database objects for an app.

```pnpm create:app [app id]```

### Run benchmark

```pnpm benchmark [app id]```

CLI flags are supported and passed through to Ponder.

```pnpm benchmark [app id] -- -v```