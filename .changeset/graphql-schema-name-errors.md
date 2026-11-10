---
"ponder": patch
---

Fixed a bug that caused a table to silently replace the GraphQL query field of another table with the same field name, such as the singular field of a `users` table and the plural field of a `user` table. Ponder now fails with `Failed to build the GraphQL schema: The query field "users" is defined by both table "user" and table "users".` Other GraphQL schema errors, such as an enum value that isn't a valid GraphQL name, now start with `Failed to build the GraphQL schema` and name the enum.
