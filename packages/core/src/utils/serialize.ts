/**
 * Serialize function that handles BigInt.
 *
 * Forked from https://github.com/wevm/wagmi
 *
 * @param value to stringify
 * @returns the stringified output
 */
export function serialize(value: any) {
  return JSON.stringify(value, (_, v) => {
    if (typeof v === "bigint") {
      return { __type: "bigint", value: v.toString() };
    }

    // JSON.stringify always attempts to call value.toJSON() on the value and then pass the result to the replacer function
    // so in order to catch Date object in raw form, we need to handle it on its parent level.
    // however that means calling `serialize(new Date())` will not format the date accordingly but it is not a use case within the lib.
    if (v !== null && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v).map(([key, value]) => {
          if (value instanceof Date) {
            return [key, { __type: "date", value: value.getTime() }];
          }
          return [key, value];
        }),
      );
    }

    return v;
  });
}

/**
 * Deserialize function that handles BigInt.
 *
 * Forked from https://github.com/wevm/wagmi
 *
 * @param value to parse
 * @returns the output object
 */
export function deserialize(value: string) {
  return JSON.parse(value, (_, value_) => {
    if (value_?.__type === "bigint") {
      return BigInt(value_.value);
    }

    if (value_?.__type === "date") {
      return new Date(value_.value);
    }

    return value_;
  });
}
