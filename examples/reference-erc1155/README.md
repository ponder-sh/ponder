# Example ERC1155 token API

This example shows how to create a GraphQL API for an ERC1155 token using Ponder. It uses the Curio Cards Tokens contract on Ethereum ([Link](https://etherscan.io/address/0x73da73ef3a6982109c4d5bdb0db9dd3e3783f313)).

## Sample query

### Get the current owner and all transfer events for a token

```graphql
{
  token(id: "7") {
    account {
      id
    }
    transferEvents {
      items {
        fromId
        toId
        timestamp
      }
    }
  }
}
```
