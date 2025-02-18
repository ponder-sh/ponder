export type Result<T> =
  | ([T] extends [never]
      ? { status: "success" }
      : { status: "success"; result: T })
  | { status: "error"; error: Error };

export type MergeResults<T extends readonly Result<any>[]> =
  T extends readonly [
    infer Head extends Result<unknown>,
    ...infer Tail extends Result<unknown>[],
  ]
    ? [Extract<Head, { status: "success" }>["result"], ...MergeResults<Tail>]
    : [];

export const mergeResults = <const T extends readonly Result<unknown>[]>(
  results: T,
): Result<MergeResults<T>> => {
  for (const result of results) {
    if (result.status === "error") {
      return result;
    }
  }

  // @ts-ignore
  return { status: "success", result: results.map((result) => result.result) };
};
