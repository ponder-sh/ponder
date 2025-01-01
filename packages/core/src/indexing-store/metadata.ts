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
    return database.wrap({ method: "_ponder_meta.getStatus()" }, async () => {
      const metadata = await database.qb.readonly
        .selectFrom("_ponder_meta")
        .select("value")
        .where("key", "=", "status")
        .executeTakeFirst();

      if (metadata!.value === null) return null;

      return metadata!.value as Status;
    });
  },
  setStatus: (status: Status) => {
    return database.wrap({ method: "_ponder_meta.setStatus()" }, async () => {
      await database.qb.user
        .insertInto("_ponder_meta")
        .values({
          key: "status",
          value: status,
        })
        .onConflict((oc) =>
          oc.column("key").doUpdateSet({
            value: status,
          }),
        )
        .execute();
    });
  },
});
