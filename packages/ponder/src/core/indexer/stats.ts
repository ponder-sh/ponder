import { Table } from "console-table-printer";

import { logger } from "@/common/logger";

const defaultStats: any = {
  totalRequestedBlockCount: 0,
  totalFetchedBlockCount: 0,

  logRequestCount: 0,
  blockRequestCount: 0,

  tableRows: [],
};

export let stats = defaultStats;

export const resetStats = () => {
  stats = defaultStats;
};

export const printStats = ({ duration }: { duration: string }) => {
  const table = new Table();

  table.addRows(stats.tableRows);

  table.printTable();

  const rpcRequestCount = stats.logRequestCount + stats.blockRequestCount;
  const cacheHitRate =
    Math.round(
      ((stats.totalRequestedBlockCount - stats.totalFetchedBlockCount) /
        stats.totalRequestedBlockCount) *
        1000
    ) / 10;

  const statsString = `(${duration}, ${rpcRequestCount} RPC request${
    rpcRequestCount === 1 ? "" : "s"
  }, ${cacheHitRate >= 99.9 ? ">99.9" : cacheHitRate}% cache hit rate)`;

  logger.info(
    `\x1b[32m${`Historical sync complete ${statsString}`}\x1b[0m`, // green
    "\n"
  );
};
