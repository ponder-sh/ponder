const cache: Partial<Record<string, Promise<Response>>> = {};

export const cachedFetch = async (
  ...args: ConstructorParameters<typeof Request>
) => {
  const req = new Request(...args);
  if (req.method !== "GET") {
    throw new Error("cachedFetch does not support methods other than GET");
  }

  const key = req.url;
  const cached = cache[key];
  if (cached) return cached.then((res) => res.clone());

  const res = fetch(req);
  cache[key] = res;

  // unset cache if fetch fails
  res.catch(() => delete cache[key]);

  return res.then((res) => res.clone());
};
