---
"ponder": patch
---

Fixed GraphQL filtering with null inputs. Null `where`, boolean-group entries, and non-equality operator values are treated as omitted filters. Equality with null uses `IS NULL` or `IS NOT NULL`, including array columns.
