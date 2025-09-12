# Offchain example

## Write to offchain tables

Hit the `/grafitti` endpoint to write data to the `accountMetadata` offchain table.

```
curl -X POST http://localhost:42069/grafitti \
  -H "Content-Type: application/json" \
  -d '{"address": "0xf73fe15cfb88ea3c7f301f16ade3c02564aca407", "message": "this is external data!"}'
```

## Join onchain and offchain data

The `/account` endpoint does a SQL-level join between the `account` table and the (offchain) `accountMetadata` table and returns the result.

```json
[
  {
  "address": "0xf73fe15cfb88ea3c7f301f16ade3c02564aca407",
  "balance": "10000000000000000000000",
  "grafitti": "this is external data!"
  },
  {
  "address": "0x9e9ef0b615d4af21c01121273498ad5deb5a3785",
  "balance": "10000000000000000000000",
  "grafitti": null
  },
  {
  "address": "0x52932f5b2767d917c3134140168f2176c94e8b2c",
  "balance": "10000000000000000000000",
  "grafitti": null
  },
  // ...
]
```