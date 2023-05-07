---
description: "API reference for the schema.graphql file"
---

# `schema.graphql`

::: tip
  See [Design your schema](/guides/design-your-schema) for a complete guide and
  API reference on schema design.
:::

Ponder currently supports a subset of the Graph Protocol schema definition language. Please [reference the Graph's documentation](https://thegraph.com/docs/en/developing/creating-a-subgraph/#the-graph-ql-schema) for more detailed documentation.

## Unsupported features

- `BigDecimal` and `ID` GraphQL field types
- Full text search
- Call handlers
- Block handlers
- Anonymous events
- The `immutable` argument to the `@entity` type directive is allowed for compatibility, but immutability is not enforced
