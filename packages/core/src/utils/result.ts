export type Result<T> =
  | { status: "success"; result: T }
  | { status: "error"; error: Error };

type UnwrapResults<T extends readonly Result<any>[]> = T extends readonly [
  infer Head extends Result<unknown>,
  ...infer Tail extends Result<unknown>[],
]
  ? [Extract<Head, { status: "success" }>["result"], ...UnwrapResults<Tail>]
  : [];

export const unwrapResults = <const T extends readonly Result<unknown>[]>(
  results: T,
): Result<UnwrapResults<T>> => {
  for (const result of results) {
    if (result.status === "error") {
      return result;
    }
  }

  // @ts-ignore
  return results.map((result) => result.result);
};
