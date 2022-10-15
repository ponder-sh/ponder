import { SingleBar } from "cli-progress";
import { Table } from "console-table-printer";

export type Stats = {
  sourceCount: number;
  sourceTotalCount: number;

  logRequestCount: number;
  blockRequestCount: number;

  requestPlanTable: Table;
  resultsTable: Table;
  contractCallsTable: Table;

  progressBar: SingleBar;

  sourceStats: Record<
    string,
    {
      matchedLogCount: number;
      handledLogCount: number;
    }
  >;

  // Contract call hit rates, by `{chainId}-${address}`
  contractCallStats: Record<
    string,
    {
      contractCallCacheHitCount: number;
      contractCallTotalCount: number;
    }
  >;
};

const buildDefaultStats = (): Stats => ({
  sourceCount: 0,
  sourceTotalCount: 0,

  logRequestCount: 0,
  blockRequestCount: 0,

  requestPlanTable: new Table(),
  resultsTable: new Table(),
  contractCallsTable: new Table(),

  progressBar: new SingleBar({
    clearOnComplete: true,
  }),

  sourceStats: {},

  contractCallStats: {},
});

export let stats = buildDefaultStats();

export const resetStats = () => {
  stats = buildDefaultStats();
};

export const getPrettyPercentage = (part: number, total: number) => {
  if (part === total) return "100%";
  const rate = Math.round((part / total) * 1000) / 10;
  if (rate >= 99.9) return ">99.9%";
  return `${rate}%`;
};
