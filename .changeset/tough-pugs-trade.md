---
"@ponder/core": minor
---

(BREAKING) Updated the GraphQL API to use cursor pagination instead of offset pagination. Note that this change also affects the `findMany` database method.

```graphql
# Before
query {
  users(offset: 10, limit: 10) {
    id
    name
  }
}
# After
query {
  users(after: "MTA=", limit: 10) {
    items {
      id
      name
    }
    before
    after
  }
}

```