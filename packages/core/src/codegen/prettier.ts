import prettier from "prettier";

let prettierConfig: prettier.Options = { parser: "typescript" };

const loadPrettierConfig = async () => {
  if (prettierConfig) return;

  const configFile = await prettier.resolveConfigFile();
  if (configFile) {
    const foundConfig = await prettier.resolveConfig(configFile);
    if (foundConfig) {
      prettierConfig = foundConfig;
    }
  }
};

// Just call this once on process start
loadPrettierConfig();

export const formatPrettier = (
  source: string,
  configOverrides?: Partial<prettier.Options>
) => {
  return prettier.format(source, { ...prettierConfig, ...configOverrides });
};
