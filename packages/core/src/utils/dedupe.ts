export const dedupe = <T>(arr: T[]): T[] => {
  const seen = new Set<T>();

  return arr.filter((x) => {
    if (seen.has(x)) return false;

    seen.add(x);
    return true;
  });
};
