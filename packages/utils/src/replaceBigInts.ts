type _ReplaceBigInts<
  arr extends readonly unknown[],
  type,
  result extends readonly unknown[] = [],
> = arr extends [infer first, ...infer rest]
  ? _ReplaceBigInts<
      rest,
      type,
      readonly [...result, first extends bigint ? type : first]
    >
  : result;

export type ReplaceBigInts<obj, type> = obj extends bigint
  ? type
  : obj extends unknown[]
    ? _ReplaceBigInts<Readonly<obj>, type>
    : obj extends readonly []
      ? _ReplaceBigInts<obj, type>
      : obj extends object
        ? { [key in keyof obj]: ReplaceBigInts<obj[key], type> }
        : obj;

export const replaceBigInts = <const T, const type>(
  obj: T,
  replacer: (x: bigint) => type,
): ReplaceBigInts<T, type> => {
  if (typeof obj === "bigint") return replacer(obj) as ReplaceBigInts<T, type>;
  if (Array.isArray(obj))
    return obj.map((x) => replaceBigInts(x, replacer)) as ReplaceBigInts<
      T,
      type
    >;
  if (obj && typeof obj === "object")
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, replaceBigInts(v, replacer)]),
    ) as ReplaceBigInts<T, type>;
  return obj as ReplaceBigInts<T, type>;
};
