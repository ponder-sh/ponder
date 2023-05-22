// These methods are used in the cached interval calculations
// From https://stackoverflow.com/a/33857786/12841788

/* This method is just a small helper method that takes an array
 * and returns a new array with duplicates removed
 */
function remove_duplicates(arr: number[][]) {
  const lookup: Record<string, number> = {};
  const results = [];
  for (let i = 0; i < arr.length; i++) {
    const el = arr[i];
    const key = el.toString();
    if (lookup[key]) continue;
    lookup[key] = 1;
    results.push(el);
  }
  return results;
}

/* This method takes 2 points p1 and p2 and returns an array of
 * points with the range of p2 removed, i.e. p1 = [1,7]
 * p2 = [4,5] returned = [[1,3],[6,7]]
 */
function p1_excluding_p2(p1: number[], p2: number[]) {
  if (p1[1] < p2[0]) return [p1]; // line p1 finishes before the exclusion line p2
  if (p1[0] > p2[1]) return [p1]; // line p1 starts after exclusion line p1
  const lines = [];
  // calculate p1 before p2 starts
  const line1 = [p1[0], Math.min(p1[1], p2[0] - 1)];
  if (line1[0] <= line1[1]) lines.push(line1);
  // calculate p1 after p2 ends
  const line2 = [p2[1] + 1, p1[1]];
  if (line2[0] <= line2[1]) lines.push(line2);
  // these contain the lines we calculated above
  return lines;
}

/* this performs the exact same operation as above, only it allows you to pass
 * multiple points (but still just 1 exclusion point) and returns results
 * in an identical format as above, i.e. points = [[1,7],[0,1]]
 *  p2 = [4,5] returned = [[0,1],[1,3],[6,7]]
 */
function points_excluding_p2(points: number[][], p2: number[]) {
  const results: number[][] = [];
  for (let i = 0; i < points.length; i++) {
    const lines = p1_excluding_p2(points[i], p2);
    results.push(...lines);
  }
  return results;
}

/* this method performs the same operation only this time it takes one point
 * and multiple exclusion points and returns an array of the results.
 * this is the important method of: given 1 point and many
 * exclusion points, return the remaining new ranges
 */
export function p1_excluding_all(p1: number[], exclude: number[][]) {
  let checking = [p1];
  for (let i = 0; i < exclude.length; i++) {
    checking = points_excluding_p2(checking, exclude[i]);
  }
  return remove_duplicates(checking);
}
