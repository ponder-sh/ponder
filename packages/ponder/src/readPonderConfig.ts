import { utils } from "ethers";
import { readFile } from "node:fs/promises";

import { CONFIG } from "@/config";
import type { PonderConfig } from "@/types";

// const defaultPonderConfig: PonderConfig = {
//   sources: [],
//   apis: [
//     {
//       kind: ApiKind.GQL,
//       port: 42069,
//     },
//   ],
//   stores: [
//     {
//       kind: StoreKind.SQL,
//       client: "sqlite3",
//       connection: {
//         filename: ":memory:",
//       },
//     },
//   ],
// };

const readPonderConfig = async () => {
  // Load and then remove the module from the require cache, because we are loading
  // it several times in the same process and need the latest version each time.
  // https://ar.al/2021/02/22/cache-busting-in-node.js-dynamic-esm-imports/
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const userConfig = require(CONFIG.PONDER_CONFIG_FILE_PATH);
  delete require.cache[require.resolve(CONFIG.PONDER_CONFIG_FILE_PATH)];

  // TODO: Validate config kek
  const validatedUserConfig = userConfig as PonderConfig;

  // Parse ABI files and add interfaces to the config object.
  const sourcesWithAbiInterfaces = await Promise.all(
    validatedUserConfig.sources.map(async (source) => {
      const abiString = await readFile(source.abi, "utf-8");
      const abiObject = JSON.parse(abiString).abi;
      const abi = abiObject.abi ? abiObject.abi : abiObject;
      return { ...source, abiInterface: new utils.Interface(abi) };
    })
  );

  const config: PonderConfig = {
    ...validatedUserConfig,
    sources: sourcesWithAbiInterfaces,
  };

  return config;
};

export { readPonderConfig };
