import { Abi } from "abitype";
import { readFileSync } from "node:fs";
import path from "node:path";

export const buildAbi = ({
  abiConfig,
  configFilePath,
}: {
  abiConfig: string | any[] | object | (string | any[] | object)[];
  configFilePath: string;
}) => {
  let resolvedAbi: Abi;
  const filePaths: string[] = [];

  if (
    typeof abiConfig === "string" ||
    (Array.isArray(abiConfig) &&
      (abiConfig.length === 0 || typeof abiConfig[0] === "object"))
  ) {
    // If abiConfig is a string or an ABI itself, treat it as a single ABI.
    const { abi, filePath } = buildSingleAbi({ abiConfig, configFilePath });
    resolvedAbi = abi;
    if (filePath) filePaths.push(filePath);
  } else {
    // Otherwise, handle as an array of of ABIs.
    const results = (abiConfig as (object | any[])[]).map((a) =>
      buildSingleAbi({ abiConfig: a, configFilePath })
    );

    const mergedAbi = results
      .map(({ abi }) => abi.filter((item) => item.type !== "constructor"))
      .flat()
      .flat();
    const mergedUniqueAbi = [
      ...new Map(
        mergedAbi.map((item) => [JSON.stringify(item), item])
      ).values(),
    ];

    filePaths.push(
      ...results.map((r) => r.filePath).filter((f): f is string => !!f)
    );

    resolvedAbi = mergedUniqueAbi;
  }

  return {
    abi: resolvedAbi,
    filePaths,
  };
};

const buildSingleAbi = ({
  abiConfig,
  configFilePath,
}: {
  abiConfig: string | any[] | object;
  configFilePath: string;
}) => {
  let filePath: string | undefined = undefined;
  let abi: Abi;

  if (typeof abiConfig === "string") {
    // If a string, treat it as a file path.
    filePath = path.isAbsolute(abiConfig)
      ? abiConfig
      : path.join(path.dirname(configFilePath), abiConfig);

    const abiString = readFileSync(filePath, "utf-8");
    abi = JSON.parse(abiString);
  } else {
    // Otherwise, treat as the ABI itself
    abi = abiConfig as unknown as Abi;
  }

  // NOTE: Not currently using the filePath arg here, but eventually
  // could use it to watch for changes and reload.
  return { abi, filePath };
};
