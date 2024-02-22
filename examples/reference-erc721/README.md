# Example ERC721 token API

This example shows how to create a GraphQL API for an ERC721 token using Ponder. It uses the Smol Brains NFT contract on Arbitrum ([Link](https://arbiscan.io/address/0x6325439389E0797Ab35752B4F43a14C004f22A9c)).

## Sample queries

### Get all tokens currently owned by an account

```graphql
{
  account(id: "0x2B8E4729672613D69e5006a97dD56A455389FB2b") {
    id
    tokens {
      id
    }
  }
}
```

### Get the current owner and all transfer events for a token

```graphql
{
  token(id: "7777") {
    owner {
      id
    }
    transferEvents {
      from
      to
      timestamp
    }
  }
}
```
