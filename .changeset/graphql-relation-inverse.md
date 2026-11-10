---
"ponder": major
---

Fixed a bug that caused a GraphQL `one` relation without `fields` and `references`, such as `profile: one(profile)` in a one-to-one relation, to return the same arbitrary row for every record. The relation now uses the `fields` and `references` of the inverse `one` relation.

A `many` relation whose table has more than one `one` relation back to the same table, such as `transfers: many(transfer)` with `transfer.from` and `transfer.to`, now fails at startup with `Failed to build the GraphQL field for relation ...` unless both sides set `relationName`. Previously, it silently used the first `one` relation.
