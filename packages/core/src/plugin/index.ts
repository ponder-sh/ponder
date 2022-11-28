import type { Ponder } from "@/Ponder";

export type ResolvedPonderPlugin = {
  name: string;
  setup?: (ponder: Ponder) => Promise<void>;
  reload?: (ponder: Ponder) => Promise<void>;
  teardown?: (ponder: Ponder) => Promise<void>;
};

export type PonderPlugin<PluginOptions = Record<string, unknown>> = (
  options?: PluginOptions
) => ResolvedPonderPlugin;
