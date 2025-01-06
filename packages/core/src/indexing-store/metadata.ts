import type { Database } from "@/database/index.js";
import type { Status } from "@/internal/types.js";

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
      const result = await database.qb.readonly
        .selectFrom("_ponder_status")
        .selectAll()
        .execute();

      if (result.length === 0) {
        return null;
      }

      const status: Status = {};

      for (const row of result) {
        status[row.chain_id] = {
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
          Object.entries(status).map(([chainId, value]) => ({
            chain_id: +chainId,
            block_number: value.block?.number,
            block_timestamp: value.block?.timestamp,
            ready: value.ready,
          })),
        )
        .onConflict((oc) =>
          oc.column("chain_id").doUpdateSet({
            // @ts-ignore
            block_number: sql`excluded.block_number`,
            // @ts-ignore
            block_timestamp: sql`excluded.block_timestamp`,
            // @ts-ignore
            ready: sql`excluded.ready`,
          }),
        )
        .execute();
    });
  },
});
