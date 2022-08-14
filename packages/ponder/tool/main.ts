import { buildDbSchema } from "./buildDbSchema";
import { buildGqlSchema } from "./buildGqlSchema";
import { buildHandlerContext } from "./buildHandlerContext";
import { fetchAndProcessLogs } from "./logs/processLogs";
import { migrateDb } from "./migrateDb";
import { readUserConfig } from "./readUserConfig";
import { readUserHandlers } from "./readUserHandlers";
import { readUserSchema } from "./readUserSchema";
import { restartServer } from "./server";
import {
  generateContractTypes,
  generateEntityTypes,
  generateHandlerTypes,
  generateSchema,
} from "./typegen";
import { generateContextType } from "./typegen/generateContextType";

const main = async () => {
  const [config, userSchema, userHandlers] = await Promise.all([
    readUserConfig(),
    readUserSchema(),
    readUserHandlers(),
  ]);

  const gqlSchema = buildGqlSchema(userSchema);
  const dbSchema = buildDbSchema(userSchema);

  const handlerContext = buildHandlerContext(config, dbSchema);

  restartServer(gqlSchema);

  generateContractTypes(config);
  generateContextType(config, dbSchema);
  generateSchema(gqlSchema);
  generateEntityTypes(gqlSchema);
  generateHandlerTypes(config);

  restartServer(gqlSchema);

  await migrateDb(dbSchema);

  await fetchAndProcessLogs(config, userHandlers, handlerContext);
};

main().catch(console.error);
