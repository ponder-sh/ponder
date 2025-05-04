import util from "node:util";
import { checksumAddress } from "viem";

export const lazyChecksumAddress = <const T extends object>(
  object: T,
  key: T extends unknown[] ? number : keyof T,
): T => {
  return {
    ...object,
    get [key]() {
      // @ts-expect-error
      return checksumAddress(object[key]);
    },
    [util.inspect.custom]: () => {
      return {
        ...object,
        // @ts-expect-error
        [key]: checksumAddress(object[key]),
      };
    },
  };
};

const cowProxies = new WeakSet<object>();

/**
 * Copy-on-write proxy.
 * @dev Objects are copied on read in order to avoid mutating inner properties.
 */
export const lazyCopy = <T extends object>(row: T): T => {
  if (cowProxies.has(row)) return row;

  let copied: T | undefined;
  const proxy = new Proxy(row, {
    get(target, prop) {
      if (copied === undefined) copied = structuredClone(row);
      return Reflect.get(target, prop);
    },
    set(target, prop, value) {
      if (copied === undefined) copied = structuredClone(row);
      return Reflect.set(target, prop, value);
    },
  });

  cowProxies.add(proxy);
  return proxy;
};
