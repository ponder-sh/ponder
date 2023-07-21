import parsePrometheusTextFormat from "parse-prometheus-text-format";

export const startClock = () => {
  const start = process.hrtime();

  return () => {
    const diff = process.hrtime(start);
    return Math.round(diff[0] * 1000 + diff[1] / 1000000);
  };
};

export const fetchWithTimeout = async (
  input: RequestInfo | URL,
  options: RequestInit & { timeout?: number } = {}
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

export const fetchGraphql = async (input: RequestInfo | URL, query: string) => {
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

export const parsePrometheusText = (text: string) => {
  const metrics = parsePrometheusTextFormat(text) as {
    name: string;
    help: string;
    type: "COUNTER" | "GAUGE" | "HISTOGRAM";
    metrics: ({ value: number } & { [key: string]: any })[];
  }[];

  return metrics;
};
