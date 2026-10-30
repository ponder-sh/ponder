// Stops only at characters that can't be part of a URL, so a key is never left
// behind, but leaves out trailing punctuation, such as in "(URL: <url>)."
const urlPattern = /\b(?:https?|wss?):\/\/[^\s"'`<>]*[^\s"'`<>.,;:!?)\]}]/gi;

/**
 * Redact every http(s) and ws(s) URL in `text` to its scheme and host
 * (`https://eth-mainnet.g.alchemy.com`). The path, query, and userinfo of an
 * RPC URL often hold an API key.
 */
export const redactUrls = (text: string): string =>
  text.replace(urlPattern, (url) => {
    try {
      const { protocol, host } = new URL(url);
      return `${protocol}//${host}`;
    } catch {
      return `${url.slice(0, url.indexOf("//") + 2)}[redacted]`;
    }
  });

/**
 * Redact the URLs in the string properties (including `message` and `stack`)
 * of `error` and its `cause` chain in place. Returns `error`.
 */
export const redactError = <error>(error: error): error => {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (
    typeof current === "object" &&
    current !== null &&
    !seen.has(current)
  ) {
    seen.add(current);
    for (const key of [...Object.keys(current), "message", "stack"]) {
      // Note: A getter can throw, and the original error must be kept.
      try {
        const value = (current as Record<string, unknown>)[key];
        if (typeof value === "string") {
          Reflect.set(current, key, redactUrls(value));
        } else if (Array.isArray(value)) {
          Reflect.set(
            current,
            key,
            value.map((v) => (typeof v === "string" ? redactUrls(v) : v)),
          );
        }
      } catch {}
    }
    try {
      current = (current as { cause?: unknown }).cause;
    } catch {
      break;
    }
  }
  return error;
};
