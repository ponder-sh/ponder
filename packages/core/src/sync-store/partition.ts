import type { Common } from "@/common/common.js";
import { type Kysely, sql as ksql } from "kysely";
import type { PonderSyncSchema } from "./encoding.js";

const PARTITION_SIZE = 10_000;

export async function createMissingPartitions({
  tableName,
  chainId,
  blockNumbers,
  db,
  common,
}: {
  tableName: string;
  chainId: number;
  blockNumbers: (number | bigint)[];
  db: Kysely<PonderSyncSchema>;
  common: Common;
}) {
  const partitionStarts = new Set<number>();
  for (const blockNumber of blockNumbers) {
    const partitionStart = Math.floor(Number(blockNumber) / PARTITION_SIZE);
    partitionStarts.add(partitionStart);
  }

  for (const partitionStart of partitionStarts) {
    const partitionTableName = `_${chainId}_${partitionStart}_${tableName}`;
    const query = ksql`
      CREATE TABLE IF NOT EXISTS ${ksql.raw("ponder_sync")}.${ksql.raw(partitionTableName)}
      PARTITION OF ${ksql.raw("ponder_sync")}.${ksql.raw(tableName)}
      FOR VALUES 
        FROM (${ksql.raw(String(partitionStart))})
        TO (${ksql.raw(String(partitionStart + PARTITION_SIZE))})
    `.compile(db);

    await db.executeQuery(query);

    common.logger.debug({
      service: "sync",
      msg: `Created ${tableName} table partition ${partitionTableName}`,
    });
  }
}
