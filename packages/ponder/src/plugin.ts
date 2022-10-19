// export type Plugin

import type { PonderLogger } from "@/common/logger";
import type { PonderOptions } from "@/common/options";
import type { PonderDatabase } from "@/db/db";
import type { Network } from "@/networks/base";
import type { Source } from "@/sources/base";

export type PonderPluginCallbackResult<PluginHandlerContext> = {
  watchFiles?: string[];
  handlerContext?: PluginHandlerContext;
};

export type ResolvedPonderPlugin<
  PluginHandlerContext = Record<string, unknown>
> = {
  name: string;
  onSetup?: (onSetupArguments: {
    database: PonderDatabase;
    sources: Source[];
    networks: Network[];
    logger: PonderLogger;
    options: PonderOptions;
  }) => Promise<PonderPluginCallbackResult<PluginHandlerContext>>;
  onBackfillComplete?: () => Promise<
    PonderPluginCallbackResult<PluginHandlerContext>
  >;
};

export type PonderPlugin<
  PluginOptions = Record<string, unknown>,
  PluginHandlerContext = Record<string, unknown>
> = (options?: PluginOptions) => ResolvedPonderPlugin<PluginHandlerContext>;
