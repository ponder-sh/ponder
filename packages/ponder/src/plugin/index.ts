// export type Plugin

import type { PonderLogger } from "@/common/logger";
import type { PonderOptions } from "@/common/options";
import type { PonderDatabase } from "@/db/db";
import type { Network } from "@/networks/base";
import type { Source } from "@/sources/base";

export type PonderPluginArgument = {
  // These properties are derived from ponder.config.js and exposed to plugins.
  database: PonderDatabase;
  sources: Source[];
  networks: Network[];
  logger: PonderLogger;
  options: PonderOptions;
  prettier: (raw: string) => string;

  // Plugin actions
  addWatchFile: (fileName: string) => void;
  emitFile: (fileName: string, contents: string | Buffer) => void;
  addToHandlerContext: (properties: Record<string, unknown>) => void;
};

export type ResolvedPonderPlugin = {
  name: string;
  setup?: (ponder: PonderPluginArgument) => Promise<void>;
  reload?: (ponder: PonderPluginArgument) => Promise<void>;
};

export type PonderPlugin<PluginOptions = Record<string, unknown>> = (
  options?: PluginOptions
) => ResolvedPonderPlugin;
