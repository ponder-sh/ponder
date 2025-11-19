import { getServerUrl } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";

export function useReady() {
  return useQuery({
    queryKey: ["ready"],
    queryFn: () =>
      fetch(`${getServerUrl()}/ready`).then((res) => res.status === 200),
  });
}
