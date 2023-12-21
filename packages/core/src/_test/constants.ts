// Test accounts
export const ACCOUNTS = [
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
] as const;

// Named accounts
export const [ALICE, BOB] = ACCOUNTS;

// Deployed contract addresses.
export const CONTRACTS = {
  erc20Address: "0x5fbdb2315678afecb367f032d93f642f64180aa3",
  factoryAddress: "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512",
} as const;
