type PostPayload = {
  endpoint: string;
  payload: object;
  signal?: AbortSignal;
};

export function postPayload({ endpoint, payload, signal }: PostPayload) {
  return fetch(endpoint, {
    method: "POST",
    body: JSON.stringify(payload),
    headers: {
      "Content-Type": "application/json",
    },
    signal,
  });
}
