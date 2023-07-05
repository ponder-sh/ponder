# Example ERC20 (rETH) token events API

This example app creates a GraphQL API that serves `Transfer` and `Approval` events for the rETH (Rocket Pool) token contract on mainnet.

It's designed to match the functionality of the [rETH Substreams Mainnet subgraph](https://thegraph.com/hosted-service/subgraph/data-nexus/reth-substreams-mainnet?selected=logs).

## Sample queries

### Get all transfer events to a specific account

```graphql
{
  transfers(where: { receiver: "0x2B8E4729672613D69e5006a97dD56A455389FB2b" }) {
    id
    sender
    receiver
    amount
    timestamp
    txHash
    blockNumber
    logIndex
  }
}
```

### Get all approval events between two timestamps

```graphql
{
  approvals(where: { timestamp_gt: 1688000000, timestamp_lt: 1688590000 }) {
    id
    sender
    receiver
    amount
    timestamp
    txHash
    blockNumber
    logIndex
  }
}
```
