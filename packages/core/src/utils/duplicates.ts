/**
 * Returns a Set containing all the duplicate elements in an array of strings.
 * @param arr - The input array of strings.
 * @returns A Set object containing the duplicate elements found in the input array.
 */
export function getDuplicateElements(arr: string[]): Set<string> {
  const uniqueElements = new Set<string>();
  const duplicates = new Set<string>();

  arr.forEach((element: string) => {
    if (uniqueElements.has(element)) {
      duplicates.add(element);
    } else {
      uniqueElements.add(element);
    }
  });

  return duplicates;
}
