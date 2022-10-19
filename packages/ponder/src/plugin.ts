// export type Plugin

import type { Logger } from "@/common/logger";
import type { Network } from "@/networks/base";
import type { Source } from "@/sources/base";
import type { PonderDatabase } from "@/stores/db";

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
    logger: Logger;
  }) => Promise<PonderPluginCallbackResult<PluginHandlerContext>>;
  onBackfillComplete?: () => Promise<
    PonderPluginCallbackResult<PluginHandlerContext>
  >;
};

export type PonderPlugin<
  PluginOptions = Record<string, unknown>,
  PluginHandlerContext = Record<string, unknown>
> = (options?: PluginOptions) => ResolvedPonderPlugin<PluginHandlerContext>;
