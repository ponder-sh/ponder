# NEWS

Note: This file only includes short summaries of the changes introduced in
each release. More detailed release notes can be found in the
[graph-node](https://github.com/graphprotocol/graph-node/tree/master/NEWS.md)
repo.

## Unreleased

- `gasUsed` in transactions has been renamed to `gasLimit`. The value has always been the
  transaction gas limit, `gasUsed` was a misnomer. Exposing the actual gas used is a future feature.

## 0.19.0

- Fix `Entity` helpers like `getBoolean`.

## 0.18.1

- Properly exprt all types in the `ethereum` module (#111).

## 0.18.0

- Add `box.profile()` to access 3Box profile data (#109).
- Add `areweave.transactionData()` to access Arweave transaction data (#109).
- Add `Bytes.fromUTF8()` helper to create byte arrays from strings (#78).
- Add `json.try_fromBytes()` for handling JSON parsing errors (#110).
- Add a `DataSourceContext` class for `SomeTemplate.createWithContext()`
  (#106, #108).
- Add support for calling overloaded Ethereum contract functions (#100).
- Add a Babylonian `.sqrt()` method to `BigInt` (#104).
- Move Ethereum integration into a dedicated `ethereum` module. Rename
  types from `EthereumBlock` to `ethereum.Block` etc. (#99).
