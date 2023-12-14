export type IndexingFunctions = {
  [sourceName: string]: {
    [eventName: string]: (...args: any) => any;
  };
};

export function validateIndexingFunctions(rawIndexingFunctions: {
  [fileName: string]: { [eventName: string]: (...args: any) => any };
}) {
  const indexingFunctions: IndexingFunctions = {};
  for (const fileFns of Object.values(rawIndexingFunctions)) {
    for (const [eventKey, fn] of Object.entries(fileFns)) {
      const [sourceName, eventName] = eventKey.split(":");
      if (!sourceName || !eventName) {
        return {
          indexingFunctions: null,
          error: new Error(`Invalid event name: ${eventKey}`),
        } as const;
      }

      indexingFunctions[sourceName] ||= {};

      if (eventName in indexingFunctions[sourceName]) {
        return {
          indexingFunctions: null,
          error: new Error(
            `Two indexing functions registered for ${eventName}`,
          ),
        } as const;
      }

      indexingFunctions[sourceName][eventName] = fn;
    }
  }

  return { indexingFunctions, error: null } as const;
}
