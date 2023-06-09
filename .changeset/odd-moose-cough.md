---
"@ponder/core": patch
---

Added entity count limits to GraphQL API server responses. By default, the server now returns only the first 100 entities (equivalent to adding `first: 100`). There is also now a hard cap of 1000 entities (`first: 1000`) in a single response. There is also a cap of 5000 entities that can be skipped (`skip: 5000`) in a single response. To paginate through a large number of entities, maintain a cursor client-side and use `where: { id_gt: previousCursor }` to fetch the next page of entities.
