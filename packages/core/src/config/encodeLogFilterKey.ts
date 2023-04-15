import { Address, Hex } from "viem";

export function encodeLogFilterKey({
  chainId,
  address,
  topics,
}: {
  chainId: number;
  address?: Address | Address[];
  topics?: (Hex | Hex[] | null)[];
}) {
  return `${chainId}-${JSON.stringify(address ?? null)}-${JSON.stringify(
    topics ?? null
  )}`;
}

export function decodeLogFilterKey({ key }: { key: string }) {
  const [chainId, addressString, topicsString] = key.split("-");

  return {
    chainId: Number(chainId),
    address:
      (JSON.parse(addressString) as Address | Address[] | null) ?? undefined,
    topics:
      (JSON.parse(topicsString) as (Hex | Hex[] | null)[] | null) ?? undefined,
  };
}
