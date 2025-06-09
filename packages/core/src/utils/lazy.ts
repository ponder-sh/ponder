import util from "node:util";
import { type Address, checksumAddress } from "viem";

/**
 * Lazy checksum address.
 *
 * @example
 * ```ts
 * const object = { address: "0x1234567890123456789012345678901234567890" };
 * lazyChecksumAddress(object, "address");
 * ```
 */
export const lazyChecksumAddress = <const T extends object>(
  object: T,
  key: T extends unknown[] ? number : keyof T,
): T => {
  // @ts-expect-error
  const address = object[key] as Address;

  Object.defineProperty(object, key, {
    get() {
      return checksumAddress(address);
    },
  });

  Object.assign(object, {
    [util.inspect.custom]: () => {
      return Object.fromEntries(
        Object.keys(object).map((k) =>
          // @ts-expect-error
          k === key ? [k, checksumAddress(address)] : [k, object[k]],
        ),
      );
    },
  });

  return object;
};
