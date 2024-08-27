export async function* mergeAsyncGenerators<T>(
  generators: AsyncGenerator<T>[],
) {
  const nextPromises = generators.map((generator) => generator.next());

  while (nextPromises.length > 0) {
    const { value, done, index } = await Promise.race(
      nextPromises.map(async (promise, i) =>
        promise.then(({ value, done }) => ({ value, done, index: i })),
      ),
    );

    if (done === false) {
      yield value;
      nextPromises[index] = generators[index]!.next();
    } else {
      nextPromises.splice(index, 1);
      generators.splice(index, 1);
    }
  }
}
