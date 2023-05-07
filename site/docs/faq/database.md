---
description: "An overview of how Ponder stores data"
---

# How does Ponder store data?

Internally, Ponder uses a SQL database. This database stores two distinct types of data:

### 1. Blockchain data (blocks, transactions, and event logs)

- **Persistent** across deploys and hot reloads
- Populated by fetching data from an Etheruem RPC (Infura, Alchemy, a local Anvil node)
- Managed internally by the Ponder indexing engine

### 2. Entity data (served by the GraphQL server)

- **Ephemeral**, does not persist across deploys or hot reloads
- Populated by event handler functions via `context.entities` objects
- Managed by the user

In development, Ponder uses SQLite because it offers excellent performance and a streamlined developer experience.

In production, Ponder uses Postgres. SQLite works for small projects in production, but struggles with larger projects due to performance and reliability issues with persistent disks.
