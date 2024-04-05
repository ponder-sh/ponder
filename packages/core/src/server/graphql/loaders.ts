import type { IndexingStore } from "@/indexing-store/store.js";
import { type Checkpoint, encodeCheckpoint } from "@/utils/checkpoint.js";
import DataLoader from "dataloader";

export type GetLoader = ReturnType<typeof buildLoaderCache>["getLoader"];

export function buildLoaderCache({ store }: { store: IndexingStore }) {
  const loaderCache: Record<
    string,
    Record<string, DataLoader<string | number | bigint, any>> | undefined
  > = {};

  const getLoader = ({
    tableName,
    checkpoint,
  }: { tableName: string; checkpoint?: Checkpoint }) => {
    const checkpointKey = checkpoint ? encodeCheckpoint(checkpoint) : "latest";

    const tableLoaders = (loaderCache[tableName] ??= {});
    const loader = (tableLoaders[checkpointKey] ??= new DataLoader(
      async (ids) => {
        const rows = await store.findMany({
          tableName,
          where: { id: { in: ids } },
          checkpoint,
          limit: ids.length,
        });

        return ids.map((id) => rows.items.find((row) => row.id === id));
      },
      { maxBatchSize: 1_000 },
    ));

    return loader;
  };

  return { getLoader };
}
