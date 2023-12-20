# Example ERC4626 token API

This example shows how to create a GraphQL API for an ERC4626 token using Ponder. It uses the Aave V2 token contract.

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
  accounts(first: 10, orderBy: "assetsBalance", orderDirection: "desc") {
    id
    balance
  }
}
```

### Get all deposit events for an account

```graphql
{
  account(id: "0x1337f7970E8399ccbc625647FCE58a9dADA5aA66") {
    depositSenderEvents {
      receiver
      assets
      shares
    }
    depositReceiverEvents {
      sender
      assets
      shares
    }
  }
}
```

### Get all withdraw events for an account

```graphql
{
  account(id: "0x1337f7970E8399ccbc625647FCE58a9dADA5aA66") {
    withdrawSenderEvents {
      receiver
      owner
      assets
      shares
    }
    withdrawReceiverEvents {
      sender
      owner
      assets
      shares
    }
    withdrawOwnerEvents {
      sender
      receiver
      assets
      shares
    }
  }
}
```
