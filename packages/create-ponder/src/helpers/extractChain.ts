import * as chains from "viem/chains";

export function extractChainName({ id }: { id: number }): string {
  return Object.entries(chains).find(([, chain]) => chain.id === id)?.[0] ?? "";
}
