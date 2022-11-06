const networkByEtherscanHostname: Record<
  string,
  { name: string; chainId: number } | undefined
> = {
  "etherscan.io": { name: "mainnet", chainId: 1 },
  "ropsten.etherscan.io": { name: "ropsten", chainId: 3 },
  "rinkeby.etherscan.io": { name: "rinkeby", chainId: 4 },
  "goerli.etherscan.io": { name: "goerli", chainId: 5 },
  "kovan.etherscan.io": { name: "kovan", chainId: 42 },
  "sepolia.etherscan.io": { name: "sepolia", chainId: 11155111 },
  "optimistic.etherscan.io": { name: "optimism", chainId: 10 },
  "kovan-optimistic.etherscan.io": { name: "optimism-kovan", chainId: 69 },
  "goerli-optimism.etherscan.io": { name: "optimism-goerli", chainId: 420 },
  "polygonscan.com": { name: "polygon", chainId: 137 },
  "mumbai.polygonscan.com": { name: "polygon-mumbai", chainId: 80001 },
  "arbiscan.io": { name: "arbitrum", chainId: 42161 },
  "testnet.arbiscan.io": { name: "arbitrum-rinkeby", chainId: 421611 },
  "goerli.arbiscan.io": { name: "arbitrum-goerli", chainId: 421613 },
};

export const getNetworkByEtherscanHostname = (hostname: string) => {
  return networkByEtherscanHostname[hostname];
};
