import type { HeadlessKysely } from "@/database/kysely.js";
import type { Status } from "@/sync/index.js";
import { sql } from "kysely";

export type MetadataStore = {
  setStatus: (status: Status) => Promise<void>;
  getStatus: () => Promise<Status | null>;
};

export const getLiveMetadataStore = ({
  db,
}: { db: HeadlessKysely<any> }): Pick<MetadataStore, "getStatus"> => ({
  getStatus: async () => {
    return db.wrap({ method: "_ponder_meta.getStatus()" }, async () => {
      const metadata = await sql
        .raw<{ value: Status | null }>(`  
WITH live AS (
    SELECT value->>'instance_id' as instance_id FROM _ponder_meta WHERE key = 'live'
)
SELECT value 
FROM _ponder_meta 
WHERE key = 'status_' || (SELECT instance_id FROM live); 
        `)
        .execute(db);

      if (!metadata.rows[0]?.value === undefined) {
        return null;
      }

      return metadata.rows[0]!.value;
    });
  },
});

export const getMetadataStore = ({
  db,
  instanceId,
}: {
  db: HeadlessKysely<any>;
  instanceId: string;
}): MetadataStore => ({
  getStatus: async () => {
    return db.wrap({ method: "_ponder_meta.getStatus()" }, async () => {
      const metadata = await db
        .selectFrom("_ponder_meta")
        .select("value")
        .where("key", "=", `status_${instanceId}`)
        .executeTakeFirst();

      if (metadata!.value === null) return null;

      return metadata!.value as Status;
    });
  },
  setStatus: (status: Status) => {
    return db.wrap({ method: "_ponder_meta.setStatus()" }, async () => {
      await db
        .insertInto("_ponder_meta")
        .values({
          key: `status_${instanceId}`,
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
