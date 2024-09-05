import type { HeadlessKysely } from "@/database/kysely.js";
import type { Status } from "@/sync/index.js";
import type { MetadataStore } from "./store.js";

export const getMetadataStore = ({
  dialect,
  db,
}: {
  dialect: "sqlite" | "postgres";
  db: HeadlessKysely<any>;
}): MetadataStore => ({
  getStatus: async () => {
    return db.wrap({ method: "_ponder_meta.getStatus()" }, async () => {
      const metadata = await db
        .selectFrom("_ponder_meta")
        .select("value")
        .where("key", "=", "status")
        .executeTakeFirst();

      if (metadata!.value === null) return null;

      return dialect === "sqlite"
        ? (JSON.parse(metadata!.value) as Status)
        : (metadata!.value as Status);
    });
  },
  setStatus: (status: Status) => {
    return db.wrap({ method: "_ponder_meta.setStatus()" }, async () => {
      await db
        .insertInto("_ponder_meta")
        .values({
          key: "status",
          value: dialect === "sqlite" ? JSON.stringify(status) : status,
        })
        .onConflict((oc) =>
          oc.column("key").doUpdateSet({
            value: dialect === "sqlite" ? JSON.stringify(status) : status,
          }),
        )
        .execute();
    });
  },
});
