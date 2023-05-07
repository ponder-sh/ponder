---
description: "A guide to create and update entities"
---

# Create & update entities

Ponder's entity store API is inspired by the [Prisma Client API](https://www.prisma.io/docs/reference/api-reference/prisma-client-reference#model-queries). The entity store API currently supports five methods:

- [`create`](/guides/create-update-entities#create)
- [`update`](/guides/create-update-entities#update)
- [`upsert`](/guides/create-update-entities#upsert)
- [`findUnique`](/guides/create-update-entities#findUnique)
- [`delete`](/guides/create-update-entities#delete)

## `create`

`create` inserts an entity into the store.

### Options

| name     | type                         |                                                |
| :------- | :--------------------------- | :--------------------------------------------- |
| **id**   | `string \| number \| bigint` | ID of the new entity                           |
| **data** | `Omit<TEntity, 'id'>`        | Data for all required fields of the new entity |

### Returns

`Promise<TEntity>`

### Example

<div className="code-columns">

```graphql filename="schema.graphql"
type Token @entity {
  id: Int!
  mintedBy: String!
  mintedAt: Int!
}
```

```ts filename="src/index.ts"
ponder.on("Blitmap:Mint", async ({ event, context }) => {
  const { Token } = context.entities;

  const token = await Token.create({
    id: event.params.tokenId,
    data: {
      mintedBy: event.params.to,
      mintedAt: event.block.timestamp
    }
  });
  // { id: 7777, mintedBy: "0x7Df1...", mintedAt: 1679507353 }
});
```

</div>

## `update`

`update` updates an existing entity in the store.

### Options

| name     | type                           |                                           |
| :------- | :----------------------------- | :---------------------------------------- |
| **id**   | `string \| number \| bigint`   | ID of the updated entity                  |
| **data** | `Omit<Partial<TEntity>, 'id'>` | Data for all updated fields of the entity |

### Returns

`Promise<TEntity>`

### Example

<div className="code-columns">

```graphql filename="schema.graphql"
type Token @entity {
  id: Int!
  ownedBy: String!
  metadataUpdatedAt: Int!
}
```

```ts filename="src/index.ts"
ponder.on("Blitmap:MetadataUpdate", async ({ event, context }) => {
  const { Token } = context.entities;

  const token = await Token.update({
    id: event.params.tokenId,
    data: {
      metadataUpdatedAt: event.block.timestamp
    }
  });
  // { id: 7777, mintedBy: "0x1bA3...", updatedAt: 1679507354 }
});
```

</div>

## `upsert`

`upsert` updates an entity if one already exists with the specified `id`, or creates a new entity.

### Options

| name       | type                           |                                                   |
| :--------- | :----------------------------- | :------------------------------------------------ |
| **id**     | `string \| number \| bigint`   | ID of the entity to create or update              |
| **create** | `Omit<TEntity, 'id'>`          | Data for all required fields of a new entity      |
| **update** | `Omit<Partial<TEntity>, 'id'>` | Data for all updated fields of an existing entity |

### Returns

`Promise<TEntity>`

### Example

`upsert` can be useful for events like the ERC721 `Transfer` event, which is emitted when a token is minted _and_ whenever a token is transferred.

<div className="code-columns">

```graphql filename="schema.graphql"
type Token @entity {
  id: Int!
  mintedBy: String!
  ownedBy: String!
}
```

```ts filename="src/index.ts"
ponder.on("Blitmap:Transfer", async ({ event, context }) => {
  const { Token } = context.entities;

  const token = await Token.upsert({
    id: event.params.tokenId,
    create: {
      mintedBy: event.params.to,
      ownedBy: event.params.to
    },
    update: {
      ownedBy: event.params.to
    }
  });
  // { id: 7777, mintedBy: "0x1bA3...", ownedBy: "0x7F4d..." }
});
```

</div>

## `findUnique`

`findUnique` finds and returns an entity by `id`.

### Options

| name   | type                         |                                     |
| :----- | :--------------------------- | :---------------------------------- |
| **id** | `string \| number \| bigint` | ID of the entity to find and return |

### Returns

`Promise<TEntity | null>`

### Example

<div className="code-columns">

```graphql filename="schema.graphql"
type Player @entity {
  id: String!
  age: Int!
}
```

```ts filename="src/index.ts"
await Player.create({ id: "Jim", age: 34 });

const jim = await Player.findUnique({ id: "Jim" });
// { id: "Jim", age: 34 }

const sara = await Player.findUnique({ id: "Sara" });
// null
```

</div>

## `delete`

`findUnique` deletes an entity by `id`.

### Options

| name   | type                         |                            |
| :----- | :--------------------------- | :------------------------- |
| **id** | `string \| number \| bigint` | ID of the entity to delete |

### Returns

`Promise<boolean>` (`true` if an entity was deleted, `false` if it was not found)

### Example

<div className="code-columns">

```graphql filename="schema.graphql"
type Player @entity {
  id: String!
  age: Int!
}
```

```ts filename="src/index.ts"
await Player.create({ id: "Jim", age: 34 });

const isDeleted = await Player.delete({ id: "Jim" });
// true

const jim = await Player.findUnique({ id: "Jim" });
// null
```

</div>
