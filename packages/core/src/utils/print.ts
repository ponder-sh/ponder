// Adapted from viem.
// https://github.com/wagmi-dev/viem/blob/021ce8e5a3fb02db6139564345a91fc77cba08a6/src/errors/transaction.ts#L6-L19
export function prettyPrint(
  args: Record<string, bigint | number | string | undefined | false | unknown>,
) {
  const entries = Object.entries(args)
    .map(([key, value]) => {
      if (value === undefined) return null;

      const trimmedValue =
        typeof value === "string" && value.length > 80
          ? value.slice(0, 80).concat("...")
          : value;

      return [key, trimmedValue];
    })
    .filter(Boolean) as [string, string][];
  const maxLength = entries.reduce(
    (acc, [key]) => Math.max(acc, key.length),
    0,
  );
  return entries
    .map(([key, value]) => `  ${`${key}`.padEnd(maxLength + 1)}  ${value}`)
    .join("\n");
}
