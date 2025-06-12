/** Waits at least a specified amount of time.
 *
 * @param milliseconds Minimum number of milliseconds to wait.
 */
export async function wait(milliseconds: number) {
  if (process.env.NODE_ENV === "test") return;
  return new Promise<void>((res) => setTimeout(res, milliseconds));
}
