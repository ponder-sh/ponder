# Example ERC20 token API

This example shows how to create a GraphQL API for an ERC20 token using Ponder. It uses the Adventure Gold token contract.

## Sample queries

### Get the current balance and all approvals for an account

```graphql
{
  account(id: "0x1337f7970E8399ccbc625647FCE58a9dADA5aA66") {
    balance
    approvals {
      spender
      amount
    }
  }
}
```

### Get the top 10 accounts by balance

```graphql
{
  accounts(first: 10, orderBy: "balance", orderDirection: "desc") {
    id
    balance
  }
}
```

### Get the current owner of the token contract

```graphql
{
  accounts(where: { isOwner: true }) {
    id
  }
}
```

### Get all transfer events for an account

```graphql
{
  account(id: "0x1337f7970E8399ccbc625647FCE58a9dADA5aA66") {
    transferEventsTo {
      from
      amount
    }
    transferEventsFrom {
      to
      amount
    }
  }
}
```
