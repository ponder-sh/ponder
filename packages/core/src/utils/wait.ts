/** Waits a specified amount of time.
 *
 * @param milliseconds Number of milliseconds to wait.
 */
export async function wait(milliseconds: number) {
  return new Promise<void>((res) => setTimeout(res, milliseconds));
}
