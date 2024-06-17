export async function drainAsyncGenerator<t extends unknown[]>(
  asyncGenerator: AsyncGenerator<t>,
) {
  const result = [] as unknown as t;

  for await (const x of asyncGenerator) {
    result.push(...x);
  }

  return result;
}
