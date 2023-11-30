export const startClock = () => {
  const start = process.hrtime();

  return () => {
    const diff = process.hrtime(start);
    return Math.round(diff[0] * 1000 + diff[1] / 1000000);
  };
};

export const fetchWithTimeout = async (
  input: string,
  options: RequestInit & { timeout?: number } = {},
) => {
  const { timeout = 2_000 } = options;

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  const response = await fetch(input, {
    ...options,
    signal: controller.signal,
  });
  clearTimeout(id);

  return response;
};

export const fetchGraphql = async (
  input: string,
  query: string,
): Promise<any> => {
  const response = await fetchWithTimeout(input, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: `query ${query}` }),
  });
  const body = await response.json();
  return body;
};
