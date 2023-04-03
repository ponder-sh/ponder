import { Abi } from "abitype";
import { readFileSync } from "node:fs";
import path from "node:path";

import { PonderOptions } from "@/config/options";
import { ResolvedPonderConfig } from "@/config/ponderConfig";

export const buildAbi = ({
  abiConfig,
  options,
}: {
  abiConfig: ResolvedPonderConfig["contracts"][number]["abi"];
  options: PonderOptions;
}) => {
  let filePath: string | undefined = undefined;
  let abi: Abi;

  if (typeof abiConfig === "string") {
    // If a string, treat it as a file path.
    filePath = path.isAbsolute(abiConfig)
      ? abiConfig
      : path.join(path.dirname(options.configFile), abiConfig);

    const abiString = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(abiString);
    // Handle the case where the ABI is the `abi` property of an object.
    // Hardhat emits ABIs like this.
    abi = "abi" in parsed ? parsed.abi : parsed;
  } else {
    // Otherwise, treat as the ABI itself
    abi = abiConfig as unknown as Abi;
  }

  // NOTE: Not currently using the filePath arg here, but eventually
  // could use it to watch for changes and reload.
  return { abi, filePath };
};
