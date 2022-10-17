# Event sources & networks

Ponder fetches event logs for each source defined in `ponder.config.js`. Then, Ponder processes each log using your event handler functions.

Each of your sources must reference a network (e.g. Ethereum mainnet, Optimism, or a local Anvil node). Here's a sample `ponder.config.js` for the CryptoPunks NFT contract.

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
