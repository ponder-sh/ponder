---
"@ponder/core": patch
---

Added GraphQL endpoint `/graphql`. The new endpoint will return an error until historical indexing has completed. This follows a similar behavior to the healthcheck (`/health`) endpoint. Serving GraphQL requests at the root `/` endpoint is being deprecated and will be removed in a future breaking release. We recommend switching API consumers to use the new endpoint at `/graphql`.
