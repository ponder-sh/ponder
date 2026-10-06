# `ponder` CLI [API reference]

The CLI (provided by the `ponder` package) is the entrypoint for your project.

```bash
Usage: ponder <command> [OPTIONS]

Options:
  --root <PATH>          Path to the project root directory (default: working directory)
  --config <PATH>        Path to the project config file (default: "ponder.config.ts")
  -v, --debug            Enable debug logs, e.g. realtime blocks, internal events
  -vv, --trace           Enable trace logs, e.g. db queries, indexing checkpoints
  --log-level <LEVEL>    Minimum log level ("error", "warn", "info", "debug", or "trace", default: "info")
  --log-format <FORMAT>  The log format ("pretty" or "json") (default: "pretty")
  -V, --version          Show the version number
  -h, --help             Show this help message

Commands:
  dev [options]          Start the development server with hot reloading
  start [options]        Start the production server
  serve [options]        Start the production HTTP server without the indexer
  db                     Database management commands
  codegen                Generate the ponder-env.d.ts file, then exit
```

## dev

Start the app in development mode.

- The app automatically restarts when changes are detected in any project file.
- An auto-updating terminal UI displays useful information.

```bash
Usage: ponder dev [options]

Start the development server with hot reloading

Options:
  --schema <SCHEMA>          Database schema (max: 45 characters)
  --disable-ui               Disable the terminal UI
  -p, --port <PORT>          Port for the web server (default: 42069)
  -H, --hostname <HOSTNAME>  Hostname for the web server (default: "0.0.0.0" or "::")
  -h, --help                 display help for command
```

## start

Start the app in production mode.

- Project files are built once on startup, and file changes are ignored.
- The terminal UI is disabled.

```bash
Usage: ponder start [options]

Start the production server

Options:
  --schema <SCHEMA>          Database schema (max: 45 characters)
  --views-schema <SCHEMA>    Views database schema (max: 45 characters)
  -p, --port <PORT>          Port for the web server (default: 42069)
  -H, --hostname <HOSTNAME>  Hostname for the web server (default: "0.0.0.0" or "::")
  -h, --help                 display help for command
```

## serve

Start the app in server-only mode. This option can be used to horizontally scale the HTTP server in production.

- Only works with Postgres.
- Project files are built once on startup, and file changes are ignored.
- Indexing is disabled.
- The HTTP server runs as normal, serving data from the connected database.

```bash
Usage: ponder serve [options]

Start the production HTTP server without the indexer

Options:
  --schema <SCHEMA>          Database schema (max: 45 characters)
  -p, --port <PORT>          Port for the web server (default: 42069)
  -H, --hostname <HOSTNAME>  Hostname for the web server (default: "0.0.0.0" or "::")
  -h, --help                 display help for command
```

## codegen

Write or update the `ponder-env.d.ts` file.

```bash
Usage: ponder codegen [options]

Generate the ponder-env.d.ts file, then exit

Options:
  -h, --help  display help for command
```

## db

Database management commands.

### create-views

Creates views for the views pattern. [Read more](/docs/production/self-hosting#views-pattern).

```bash
Usage: ponder create-views [options]

Create database views for the views pattern

Options:
  --schema <SCHEMA>          Database schema (max: 45 characters)
  --views-schema <SCHEMA>    Views database schema (max: 45 characters)
  -h, --help                 display help for command
```


### list

List all `ponder start` instances that have ever ran in the connected database.

```bash
Usage: ponder db list [options]

List all Ponder deployments

Options:
  -h, --help  display help for command
```

```bash [Result]
│ Schema        │ Active   │ Last active    │ Table count │
├───────────────┼──────────┼────────────────┼─────────────┤
│ indexer_prod  │      yes │            --- │          10 │
│ test          │       no │    26m 58s ago │          10 │
│ demo          │       no │      1 day ago │           5 │
```

### prune

Drop all database tables, functions, and schemas created by Ponder deployments that are not currently active.

```bash
Usage: ponder db prune [options]

Drop all database tables, functions, and schemas created by Ponder deployments that are not active

Options:
  -h, --help  display help for command
```
