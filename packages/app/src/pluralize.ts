const pluralRules = new Intl.PluralRules("en-US");

export const pluralize = (count: number, singular: string, plural: string) => {
  const rule = pluralRules.select(count);
  switch (rule) {
    case "one":
      return `${count} ${singular}`;
    case "other":
      return `${count} ${plural}`;
    default:
      throw new Error(`Unsupported plural rule: ${rule}`);
  }
};
