export function postEvent({
  payload,
  signal,
}: {
  payload: object;
  signal?: AbortSignal;
}) {
  return fetch("https://ponder.sh/api/telemetry", {
    method: "POST",
    body: JSON.stringify(payload),
    headers: {
      "Content-Type": "application/json",
    },
    signal,
  });
}
