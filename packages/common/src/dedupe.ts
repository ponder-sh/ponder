export const dedupe = <item, id>(
  arr: item[],
  getId?: (x: item) => id,
): item[] => {
  const seen = new Set<id | item>();

  return arr.filter((x) => {
    if (seen.has(getId ? getId(x) : x)) return false;

    seen.add(x);
    return true;
  });
};
