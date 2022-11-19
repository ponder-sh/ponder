import type { EvmSource } from "./evm";

export interface BaseSource {
  kind: SourceKind;
}

export enum SourceKind {
  EVM = "evm",
}

export type Source = EvmSource;
