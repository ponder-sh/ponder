// import { ErrorService } from "@/common/ErrorService";
// import { LoggerService } from "@/common/LoggerService";
// import { buildOptions } from "@/common/options";
// import { buildContracts } from "@/config/contracts";
// import { buildNetworks } from "@/config/networks";
// import { buildCacheStore } from "@/db/cache/cacheStore";
// import { buildDb } from "@/db/db";
// import { buildEntityStore } from "@/db/entity/entityStore";
// import { Resources } from "@/Ponder";

// function buildTestResource() {
//   const options = buildOptions({});

//   const logger = new LoggerService();
//   const errors = new ErrorService();
//   const database = buildDb({ options, config, logger });
//   const cacheStore = buildCacheStore({ database });
//   const entityStore = buildEntityStore({ database });

//   const networks = buildNetworks({ config, cacheStore });
//   const contracts = buildContracts({
//     options,
//     config,
//     networks,
//   });

//   const resources: Resources = {
//     options,
//     config,
//     database,
//     cacheStore,
//     entityStore,
//     contracts,
//     logger,
//     errors,
//   };

//   return resources;
// }

// describe("new", () => {});
