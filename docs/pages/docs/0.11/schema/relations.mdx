# Relations [Define relationships between database tables]

Ponder uses [Drizzle Relations](https://orm.drizzle.team/docs/relations) to define relationships between tables. This guide describes each kind of relationship and how to use them.

:::info
  Relations *only* enrich the GraphQL API and Drizzle Query API (`findMany` and `findFirst`). They **do not** create foreign key constraints, and won't stop you from inserting rows that violate referential integrity.
:::

## One-to-one

Use the `relations` function exported by `ponder` to define the relationships for a table.

To define a one-to-one relationship, use the `one()` operator and specify which columns relate the two tables. In this example, each user has a profile and each profile belongs to one user.

```ts [ponder.schema.ts]
import { onchainTable, relations } from "ponder"; // [!code focus]

export const users = onchainTable("users", (t) => ({
  id: t.text().primaryKey(),
}));

export const usersRelations = relations(users, ({ one }) => ({ // [!code focus]
  profile: one(profiles, { fields: [users.id], references: [profiles.userId] }), // [!code focus]
})); // [!code focus]

export const profiles = onchainTable("profiles", (t) => ({
  id: t.text().primaryKey(),
  userId: t.text().notNull(),
  age: t.integer().notNull(),
}));
```

Now that you've defined the relationship, the `profile` field will become available in the Query API (`findMany` and `findFirst`) using the `with` option.

```ts [src/index.ts]
import { users, profiles } from "ponder:schema";

await db.insert(users).values({ id: "hunter42" });
await db.insert(profiles).values({ userId: "hunter42", age: 29 });

const user = await db.sql.query.users.findFirst({
  where: eq(users.id, "hunter42"),
  with: { profile: true },
});

console.log(user.profile.age);
//          ^? { id: string; profile: { id: string; userId: string; age: number } }
```

## One-to-many

To define a one-to-many relationship, use the `one()` and `many()` operators to define both sides of the relationship. In this example, each dog has one owner and each person can own many dogs.

```ts [ponder.schema.ts]
import { onchainTable, relations } from "ponder"; // [!code focus]

export const persons = onchainTable("persons", (t) => ({
  name: t.text().primaryKey(),
}));

export const personsRelations = relations(persons, ({ many }) => ({ // [!code focus]
  dogs: many(dogs), // [!code focus]
})); // [!code focus]

export const dogs = onchainTable("dogs", (t) => ({
  petId: t.text().primaryKey(),
  ownerName: t.text().notNull(),
}));

export const dogsRelations = relations(dogs, ({ one }) => ({ // [!code focus]
  owner: one(persons, { fields: [dogs.ownerName], references: [persons.name] }), // [!code focus]
})); // [!code focus]
```

Now, any row inserted into the `dogs` table with `ownerName: "Bob"` will become available in Bob's `dogs` field.

```ts [src/index.ts]
import { persons, dogs } from "ponder:schema";

await db.insert(persons).values({ name: "Bob" });
await db.insert(dogs).values([
  { petId: "Chip", ownerName: "Bob" },
  { petId: "Spike", ownerName: "Bob" },
]);

const bob = await db.sql.query.persons.findFirst({
  where: eq(persons.id, "Bob"),
  with: { dogs: true },
});

console.log(bob.dogs);
//          ^? { name: string; dogs: { petId: string; age: number }[] }
```

:::info
  Note that in a one-to-many relationship, you cannot directly set the value of
  the `many` field. Instead, you must insert or update the related rows
  individually.
:::

## Many-to-many

To define a many-to-many relationship, create a "join table" that relates the two tables you want to connect using two one-to-many relationships.

```ts [ponder.schema.ts]
import { onchainTable, relations, primaryKey } from "ponder";

export const users = onchainTable("users", (t) => ({
  id: t.text().primaryKey(),
}));

export const usersRelations = relations(users, ({ many }) => ({
  userTeams: many(userTeams),
}));

export const teams = onchainTable("teams", (t) => ({
  id: t.text().primaryKey(),
  mascot: t.text().notNull(),
}));

export const teamsRelations = relations(teams, ({ many }) => ({
  userTeams: many(userTeams),
}));

export const userTeams = onchainTable(
  "user_teams",
  (t) => ({
    userId: t.text().notNull(),
    teamId: t.text().notNull(),
  }),
  // A composite primary key is often a good choice for a join table.
  (table) => ({ pk: primaryKey({ columns: [table.userId, table.teamId] }) })
);

export const userTeamsRelations = relations(userTeams, ({ one }) => ({
  user: one(users, { fields: [userTeams.userId], references: [users.id] }),
  team: one(teams, { fields: [userTeams.teamId], references: [teams.id] }),
}));
```

Each row in the `userTeams` table represents a relationship between a `user` and `team` row. You can query for the relationship by nesting the `with` option in the Query API.

```ts [src/index.ts]
import { users, teams, userTeams } from "ponder:schema";

await db.insert(users).values([
  { id: "ron" }, { id: "harry" }, { id: "hermione" }
]);
await db.insert(teams).values([
  { id: "muggle", mascot: "dudley" },
  { id: "wizard", mascot: "hagrid" },
]);
await db.insert(userTeams).values([
  { userId: "ron", teamId: "wizard" },
  { userId: "harry", teamId: "wizard" },
  { userId: "hermione", teamId: "muggle" },
  { userId: "hermione", teamId: "wizard" },
]);

const hermione = await db.sql.query.users.findFirst({
  where: eq(users.id, "hermione"),
  with: { userTeams: { with: { team: true } } },
});

console.log(hermione.userTeams);
//          ^? {
//            id: string;
//            userTeams: {
//              userId: string;
//              teamId: string;
//              team: {
//                id: string;
//                mascot: string
//              }
//            }[]
//          }
```

## GraphQL API

Every relationship you define in `ponder.schema.ts` automatically becomes available in the GraphQL API, with `one` relations creating singular fields and `many` relations creating plural/connection fields.

The [one-to-many example](#one-to-many) above corresponds to the following GraphQL query and result.

<div className="code-columns">

```graphql [Query]
query {
  person(id: "Bob") {
    id
    dogs {
      id
    }
  }
}
```

```json [Result]
{
  "person": {
    "id": "Bob",
    "dogs": [
      { "id": "Chip" },
      { "id": "Spike" }
    ]
  }
}
```

</div>


