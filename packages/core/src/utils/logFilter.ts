import { Hex } from "viem";

/**
 * Generates log filter fragments from a log filter.
 *
 * @param logFilter Log filter to be decompose into fragments.
 * @returns A list of log filter fragments.
 */
export function buildLogFilterFragments({
  address,
  topics,
}: {
  address?: Hex | Hex[];
  topics?: (Hex | Hex[] | null)[];
}) {
  const fragments: {
    id: string;
    address: Hex | null;
    topic0: Hex | null;
    topic1: Hex | null;
    topic2: Hex | null;
    topic3: Hex | null;
  }[] = [];

  const { topic0, topic1, topic2, topic3 } = parseTopics(topics);

  for (const address_ of Array.isArray(address) ? address : [address ?? null]) {
    for (const topic0_ of Array.isArray(topic0) ? topic0 : [topic0]) {
      for (const topic1_ of Array.isArray(topic1) ? topic1 : [topic1]) {
        for (const topic2_ of Array.isArray(topic2) ? topic2 : [topic2]) {
          for (const topic3_ of Array.isArray(topic3) ? topic3 : [topic3]) {
            fragments.push({
              id: `${address_}_${topic0_}_${topic1_}_${topic2_}_${topic3_}`,
              address: address_,
              topic0: topic0_,
              topic1: topic1_,
              topic2: topic2_,
              topic3: topic3_,
            });
          }
        }
      }
    }
  }

  return fragments;
}

function parseTopics(topics: (Hex | Hex[] | null)[] | undefined) {
  return {
    topic0: topics?.[0] ?? null,
    topic1: topics?.[1] ?? null,
    topic2: topics?.[2] ?? null,
    topic3: topics?.[3] ?? null,
  } as {
    topic0: Hex | Hex[] | null;
    topic1: Hex | Hex[] | null;
    topic2: Hex | Hex[] | null;
    topic3: Hex | Hex[] | null;
  };
}
