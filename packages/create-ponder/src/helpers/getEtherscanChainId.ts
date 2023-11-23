const networkByEtherscanHostname: Record<
  string,
  { name: string; chainId: number; apiUrl: string } | undefined
> = {
  "etherscan.io": {
    name: "mainnet",
    chainId: 1,
    apiUrl: "https://api.etherscan.io/api",
  },
  "ropsten.etherscan.io": {
    name: "ropsten",
    chainId: 3,
    apiUrl: "https://api-ropsten.etherscan.io/api",
  },
  "rinkeby.etherscan.io": {
    name: "rinkeby",
    chainId: 4,
    apiUrl: "https://api-rinkeby.etherscan.io/api",
  },
  "goerli.etherscan.io": {
    name: "goerli",
    chainId: 5,
    apiUrl: "https://api-goerli.etherscan.io/api",
  },
  "kovan.etherscan.io": {
    name: "kovan",
    chainId: 42,
    apiUrl: "https://api-kovan.etherscan.io/api",
  },
  "sepolia.etherscan.io": {
    name: "sepolia",
    chainId: 11155111,
    apiUrl: "https://api-sepolia.etherscan.io/api",
  },
  "optimistic.etherscan.io": {
    name: "optimism",
    chainId: 10,
    apiUrl: "https://api-optimistic.etherscan.io/api",
  },
  "goerli-optimism.etherscan.io": {
    name: "optimism-goerli",
    chainId: 420,
    apiUrl: "https://api-goerli-optimistic.etherscan.io/api",
  },
  "polygonscan.com": {
    name: "polygon",
    chainId: 137,
    apiUrl: "https://api.polygonscan.com/api",
  },
  "mumbai.polygonscan.com": {
    name: "polygon-mumbai",
    chainId: 80001,
    apiUrl: "https://api-testnet.polygonscan.com/api",
  },
  "arbiscan.io": {
    name: "arbitrum",
    chainId: 42161,
    apiUrl: "https://api.arbiscan.io/api",
  },
  "goerli.arbiscan.io": {
    name: "arbitrum-goerli",
    chainId: 421613,
    apiUrl: "https://api-goerli.arbiscan.io/api",
  },
  "explorer.zora.energy": {
    name: "zora",
    chainId: 7777777,
    apiUrl: "https://explorer.zora.energy/api",
  },
  "basescan.org": {
    name: "base",
    chainId: 8453,
    apiUrl: "https://api.basescan.org/api",
  },
  "goerli.basescan.org": {
    name: "base-goerli",
    chainId: 84531,
    apiUrl: "https://api-goerli.basescan.org/api",
  },
};

export const getNetworkByEtherscanHostname = (hostname: string) => {
  return networkByEtherscanHostname[hostname];
};
