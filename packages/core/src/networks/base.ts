import type { EvmNetwork } from "./evm";

export interface BaseNetwork {
  kind: NetworkKind;
}

export enum NetworkKind {
  EVM = "evm",
}

export type Network = EvmNetwork;
