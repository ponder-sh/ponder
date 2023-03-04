import prettier from "prettier";

let prettierConfig: prettier.Options = { parser: "typescript" };

const loadPrettierConfig = async () => {
  if (prettierConfig) return prettierConfig;

  const configFilePath = await prettier.resolveConfigFile();
  if (configFilePath) {
    const foundConfig = await prettier.resolveConfig(configFilePath);
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
