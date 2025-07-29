import util from "node:util";
import { type Address, checksumAddress } from "viem";

declare global {
  var SKIP_CHECKSUM: boolean;
}

const inspect = new Function(
  "object",
  "key",
  `
  return Object.fromEntries(
    Object.keys(object).map((k) =>
      k === key ? [k, checksumAddress(address)] : [k, object[k]],
    ),
  );`,
);

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
      if (SKIP_CHECKSUM) {
        return address;
      }
      return checksumAddress(address);
    },
  });

  Object.assign(object, { [util.inspect.custom]: () => inspect(object, key) });

  return object;
};
