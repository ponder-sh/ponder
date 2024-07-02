export type Latest = {
  [network: string]: { blockNumber: number; sync: "historical" | "realtime" };
};
