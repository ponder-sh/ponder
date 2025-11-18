import type { JsonSchema } from "@/lib/drizzle-kit";
import { getServerUrl } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";

export function useSchema() {
  // TODO(kyle) how to refresh when the schema changes?
  return useQuery<JsonSchema>({
    queryKey: ["schema"],
    queryFn: () =>
      fetch(`${getServerUrl()}/sql/schema`).then((res) => res.json()),
    staleTime: Number.POSITIVE_INFINITY,
  });
}
