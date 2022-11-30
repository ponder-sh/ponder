# Event sources & networks

**Sources** are EVM smart contracts, and **networks** are EVM blockchains (e.g. Ethereum mainnet, Optimism, a local Anvil node, etc).

Sources and networks are specified in `ponder.config.js`. To fetch the event log data for a source, Ponder sends RPC requests to the corresponding `network.rpcUrl`. Each source must reference a network by name. Here's a sample `ponder.config.js` for the CryptoPunks NFT contract.

```js
// ponder.config.js

module.exports = {
  networks: {
    name: "mainnet",
    chainId: 1,
    rpcUrl: "https://eth-mainnet.g.alchemy.com/v2/..."
  },
  sources: [
    {
      name: "CryptoPunks",
      network: "mainnet", // References mainnet network defined above
      abi: "./abis/CryptoPunks.json",
      address: "0xb47e3cd837dDF8e4c57F05d70Ab865de6e193BBB",
      startBlock: 3914495,
    },
  ]
  ...
};
```
