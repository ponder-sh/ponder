import type { HeadlessKysely } from "@/database/kysely.js";
import type { NamespaceInfo } from "@/database/service.js";
import type { MetadataStore, Status } from "./store.js";

export const getMetadataStore = ({
  encoding,
  namespaceInfo,
  db,
}: {
  encoding: "sqlite" | "postgres";
  namespaceInfo: NamespaceInfo;
  db: HeadlessKysely<any>;
}): MetadataStore => ({
  getStatus: async () => {
    return db.wrap({ method: "_metadata.getLatest()" }, async () => {
      const metadata = await db
        .withSchema(namespaceInfo.userNamespace)
        .selectFrom("ponder_metadata")
        .select("value")
        .where("key", "=", "status")
        .executeTakeFirst();

      if (metadata!.value === null) return null;

      return encoding === "sqlite"
        ? (JSON.parse(metadata!.value) as Status)
        : (metadata!.value as Status);
    });
  },
  setStatus: (status: Status) => {
    return db.wrap({ method: "_metadata.setLatest()" }, async () => {
      await db
        .withSchema(namespaceInfo.userNamespace)
        .insertInto("ponder_metadata")
        .values({
          key: "status",
          value: encoding === "sqlite" ? JSON.stringify(status) : status,
        })
        .onConflict((oc) =>
          oc.column("key").doUpdateSet({
            value: encoding === "sqlite" ? JSON.stringify(status) : status,
          }),
        )
        .execute();
    });
  },
});
