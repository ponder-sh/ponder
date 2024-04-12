export type RawIndexingFunctions = {
  name: string;
  fn: (...args: any) => any;
}[];

export type IndexingFunctions = {
  [sourceName: string]: {
    [eventName: string]: (...args: any) => any;
  };
};

export function buildIndexingFunctions({
  rawIndexingFunctions,
}: { rawIndexingFunctions: RawIndexingFunctions }) {
  const warnings: string[] = [];

  let indexingFunctionCount = 0;
  const indexingFunctions: IndexingFunctions = {};

  for (const { name: eventKey, fn } of rawIndexingFunctions) {
    const eventNameComponents = eventKey.split(":");
    const [sourceName, eventName] = eventNameComponents;
    if (eventNameComponents.length !== 2 || !sourceName || !eventName) {
      throw new Error(
        `Validation failed: Invalid event '${eventKey}', expected format '{contractName}:{eventName}'.`,
      );
    }

    indexingFunctions[sourceName] ||= {};

    if (eventName in indexingFunctions[sourceName]) {
      throw new Error(
        `Validation failed: Multiple indexing functions registered for event '${eventKey}'.`,
      );
    }

    indexingFunctions[sourceName][eventName] = fn;
    indexingFunctionCount += 1;
  }

  if (indexingFunctionCount === 0) {
    warnings.push("No indexing functions were registered.");
  }

  return { indexingFunctions, warnings } as const;
}

export function safeBuildIndexingFunctions({
  rawIndexingFunctions,
}: { rawIndexingFunctions: RawIndexingFunctions }) {
  try {
    const result = buildIndexingFunctions({ rawIndexingFunctions });

    return {
      status: "success",
      indexingFunctions: result.indexingFunctions,
      warnings: result.warnings,
    } as const;
  } catch (error_) {
    const error = error_ as Error;
    return { status: "error", error } as const;
  }
}
