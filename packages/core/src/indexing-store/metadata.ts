import type { Database } from "@/database/index.js";
import type { Status } from "@/internal/types.js";
import { sql } from "kysely";

export type MetadataStore = {
  setStatus: (status: Status) => Promise<void>;
  getStatus: () => Promise<Status | null>;
};

export const getMetadataStore = ({
  database,
}: {
  database: Database;
}): MetadataStore => ({
  getStatus: async () => {
    return database.wrap({ method: "_ponder_status.get()" }, async () => {
      const result = await database.qb.user
        .selectFrom("_ponder_status")
        .selectAll()
        .execute();

      if (result.length === 0) {
        return null;
      }

      const status: Status = {};

      for (const row of result) {
        status[row.network_name] = {
          block:
            row.block_number && row.block_timestamp
              ? {
                  number: Number(row.block_number),
                  timestamp: Number(row.block_timestamp),
                }
              : null,
          ready: row.ready,
        };
      }

      return status;
    });
  },
  setStatus: (status: Status) => {
    return database.wrap({ method: "_ponder_status.set()" }, async () => {
      await database.qb.user
        .insertInto("_ponder_status")
        .values(
          Object.entries(status).map(([networkName, value]) => ({
            network_name: networkName,
            block_number: value.block?.number,
            block_timestamp: value.block?.timestamp,
            ready: value.ready,
          })),
        )
        .onConflict((oc) =>
          oc.column("network_name").doUpdateSet({
            block_number: sql`excluded.block_number`,
            block_timestamp: sql`excluded.block_timestamp`,
            ready: sql`excluded.ready`,
          }),
        )
        .execute();
    });
  },
});
