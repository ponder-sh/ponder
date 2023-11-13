import type { Abi } from "abitype";
import type { AbiItem } from "viem";
import { formatAbiItem } from "viem/utils";

export type MergeAbi<
  TBase extends Abi,
  TInsert extends Abi,
> = TInsert extends readonly [
  infer First extends AbiItem,
  ...infer Rest extends Abi,
]
  ? Extract<TBase[number], First> extends never
    ? MergeAbi<readonly [...TBase, First], Rest>
    : MergeAbi<TBase, Rest>
  : TBase;

type MergeAbis<
  TAbis extends readonly Abi[],
  TMerged extends Abi = [],
> = TAbis extends readonly [
  infer First extends Abi,
  ...infer Rest extends readonly Abi[],
]
  ? MergeAbis<Rest, MergeAbi<TMerged, First>>
  : TMerged;

const isAbiItemEqual = (a: AbiItem, b: AbiItem): boolean =>
  formatAbiItem(a) === formatAbiItem(b);

/**
 * Combine multiple ABIs into one, removing duplicates if necessary.
 */
export const mergeAbis = <const TAbis extends readonly Abi[]>(abis: TAbis) => {
  let merged: Abi = [];

  for (const abi of abis) {
    for (const item of abi) {
      // Don't add a duplicate items
      // if item is already in merged, don't add it
      if (!merged.some((m) => isAbiItemEqual(m, item))) {
        merged = [...merged, item];
      }
    }
  }

  return merged as MergeAbis<TAbis>;
};
