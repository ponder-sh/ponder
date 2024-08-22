import { type Address, checksumAddress as viemChecksumAddress } from "viem";

type ChecksumAddressParameters = Parameters<typeof viemChecksumAddress>;

const cache = new Map<
  ChecksumAddressParameters,
  {
    address: Address;
    op: number;
  }
>();

let ops = 0;

export const checksumAddress = (
  ...params: Parameters<typeof viemChecksumAddress>
) => {
  if (cache.has(params)) {
    const entry = cache.get(params)!;
    entry.op = ops++;
    return entry.address;
  }

  const address = viemChecksumAddress(...params);

  cache.set(params, {
    address,
    op: ops++,
  });

  if (cache.size > 100) {
    const flush = ops - 20;
    for (const [key, { op }] of cache) {
      if (op < flush) cache.delete(key);
    }
  }

  return structuredClone(address);
};
