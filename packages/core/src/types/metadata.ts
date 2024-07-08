export type Status = {
  [networkName: string]: { blockTimestamp: number; isBackfill: boolean };
};
