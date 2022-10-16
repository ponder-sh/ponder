import { CONFIG } from "@/common/config";
import type { PonderConfig } from "@/core/readPonderConfig";
import type { EntityStore } from "@/stores/baseEntityStore";

import { GraphqlServer } from "./graphql";

export const buildGraphqlServer = ({
  config,
  entityStore,
}: {
  config: PonderConfig;
  entityStore: EntityStore;
}) => {
  const port = config.graphql?.port || CONFIG.GRAPHQL_SERVER_PORT;
  return new GraphqlServer(port, entityStore);
};
