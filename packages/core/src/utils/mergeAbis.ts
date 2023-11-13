import type { Abi } from "abitype";

type MergeAbis<
  TMerged extends Abi,
  TImpls extends readonly Abi[]
> = TImpls extends readonly [
  infer First extends Abi,
  ...infer Rest extends readonly Abi[]
]
  ? MergeAbis<[...TMerged, ...First], Rest>
  : TMerged;

/**
 * Build a single Abi from a proxy and its implementations
 */
export const mergeAbis = <TProxy extends Abi, TImpl extends readonly Abi[]>([
  proxy,
  ...impls
]: readonly [TProxy, ...TImpl]) => {
  let merged: Abi = proxy;

  for (const impl of impls) {
    merged = [...merged, ...impl];
  }

  return merged as MergeAbis<TProxy, TImpl>;
};
