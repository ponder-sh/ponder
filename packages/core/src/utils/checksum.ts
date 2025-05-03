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
