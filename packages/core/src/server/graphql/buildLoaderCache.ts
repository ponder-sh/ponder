import type { IndexingStore } from "@/indexing-store/store.js";
import DataLoader from "dataloader";

export type GetLoader = ReturnType<typeof buildLoaderCache>;

export function buildLoaderCache({ store }: { store: IndexingStore }) {
  const loaderCache: Record<
    string,
    DataLoader<string | number | bigint, any> | undefined
  > = {};

  return ({ tableName }: { tableName: string }) => {
    const loader = (loaderCache[tableName] ??= new DataLoader(
      async (ids) => {
        const rows = await store.findMany({
          tableName,
          where: { id: { in: ids } },
        });

        return ids.map((id) => rows.items.find((row) => row.id === id));
      },
      { maxBatchSize: 1_000 },
    ));

    return loader;
  };
}
