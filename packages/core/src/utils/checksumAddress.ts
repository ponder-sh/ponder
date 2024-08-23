import { type Address, checksumAddress as viemChecksumAddress } from "viem";

const cache = new Map<
  string,
  {
    address: Address;
    op: number;
  }
>();

let ops = 0;

export const checksumAddress = (
  ...params: Parameters<typeof viemChecksumAddress>
) => {
  const key = `${params[0]}_${params[1] ?? ""}`;
  if (cache.has(key)) {
    const entry = cache.get(key)!;
    entry.op = ops++;
    return entry.address;
  }

  const address = viemChecksumAddress(...params);
  cache.set(key, { address, op: ops++ });

  if (cache.size > 100) {
    const flush = ops - 20;
    for (const [key, { op }] of cache) {
      if (op < flush) cache.delete(key);
    }
  }

  return structuredClone(address);
};
