import { sql } from "kysely";
import type { HeadlessKysely } from "./kysely.js";
import type { NamespaceInfo } from "./service.js";

export const getLatest = async ({
  db,
  namespaceInfo,
}: {
  db: HeadlessKysely<any>;
  namespaceInfo: NamespaceInfo;
}) => {
  const latest = await db
    .with("checkpoints", (db) => {
      const logCheckpoints = Object.values(namespaceInfo.internalTableIds).map(
        (tableId) =>
          db
            .withSchema(namespaceInfo.internalNamespace)
            .selectFrom(tableId)
            .select("checkpoint"),
      );

      return logCheckpoints.reduce<(typeof logCheckpoints)[number] | undefined>(
        (acc, cur) => {
          if (acc === undefined) acc = cur;
          else acc = acc.unionAll(cur);
          return acc;
        },
        undefined,
      )!;
    })
    .selectFrom("checkpoints")
    .select([
      sql`SUBSTR(checkpoint, 11, 16)`.as("chainId"),
      sql`SUBSTR(checkpoint, 27, 16)`.as("blockNumber"),
    ])
    .groupBy("chainId")
    .orderBy("blockNumber", "desc")
    .execute();

  await db.executeQuery(
    sql`
      UPDATE _metadata
      SET value = jsonb_set("value", '$.mainnet.blockNumber', '10')
      WHERE key = 'latest'
  `.compile(db),
  );
};
