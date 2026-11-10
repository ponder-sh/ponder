---
"ponder": major
---

Updated the `graphql()` middleware to keep the HTTP status codes of the GraphQL over HTTP spec instead of returning `200` for every response. Requests with invalid JSON now return `400`, unsupported content types return `415`, and requests that accept `application/graphql-response+json` return `400` for syntax and validation errors. Requests that accept only `application/json` still return `200` for these errors.
