import type { HeadlessKysely } from "@/database/kysely.js";
import type { NamespaceInfo } from "@/database/service.js";
import type { Latest } from "@/types/metadata.js";
import type { MetadataStore } from "./store.js";

export const getMetadataStore = ({
  encoding,
  namespaceInfo,
  db,
}: {
  encoding: "sqlite" | "postgres";
  namespaceInfo: NamespaceInfo;
  db: HeadlessKysely<any>;
}): MetadataStore => ({
  getLatest: async () => {
    return db.wrap({ method: "_metadata.getLatest()" }, async () => {
      const metadata = await db
        .withSchema(namespaceInfo.userNamespace)
        .selectFrom("_metadata")
        .select("value")
        .where("key", "=", "latest")
        .executeTakeFirst();

      if (metadata === undefined) return undefined;

      return encoding === "sqlite"
        ? (JSON.parse(metadata.value) as Latest)
        : (metadata.value as Latest);
    });
  },
  setLatest: (latest: Latest) => {
    return db.wrap({ method: "_metadata.setLatest()" }, async () => {
      await db
        .withSchema(namespaceInfo.userNamespace)
        .insertInto("_metadata")
        .values({
          key: "latest",
          value: encoding === "sqlite" ? JSON.stringify(latest) : latest,
        })
        .onConflict((oc) =>
          oc.column("key").doUpdateSet({
            value: encoding === "sqlite" ? JSON.stringify(latest) : latest,
          }),
        )
        .execute();
    });
  },
});
