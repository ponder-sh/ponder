---
"@ponder/core": minor
---

(BREAKING) Updated the GraphQL API to use cursor pagination instead of offset pagination. Note that this change also affects the `findMany` database method. See the [GraphQL pagination docs](https://ponder.sh/docs/guides/query-the-graphql-api#pagination) for more details.

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
    pageInfo {
      hasPreviousPage
      hasNextPage
      starCursor
      endCursor
    }
  }
}

```