import { Address, Hex } from "viem";

// Null values represent "unspecified".
export type FilterAddress = Address | Address[] | null;
export type FilterTopics = (Hex | Hex[] | null)[] | null;

export function encodeLogFilterKey({
  chainId,
  address,
  topics,
}: {
  chainId: number;
  address: FilterAddress;
  topics: FilterTopics;
}) {
  return `${chainId}-${JSON.stringify(address)}-${JSON.stringify(topics)}`;
}

export function decodeLogFilterKey({ key }: { key: string }) {
  const [chainId, addressString, topicsString] = key.split("-");

  return {
    chainId: Number(chainId),
    address: JSON.parse(addressString) as FilterAddress,
    topics: JSON.parse(topicsString) as FilterTopics,
  };
}
