import { expect, test } from "bun:test";
import { HttpRequestError, TimeoutError } from "viem";
import { redactError, redactUrls } from "./redact.js";

test("redactUrls", () => {
  expect(
    redactUrls(
      [
        "https://eth-mainnet.g.alchemy.com/v2/secret",
        "https://rpc.example.com:8545/?apikey=secret#x",
        "https://user:secret@rpc.example.com/",
        "wss://rpc.example.com/ws/secret",
        "http://localhost:8545",
        "URL: https://a.quiknode.pro/secret/\nRequest body: {}",
        '{"url":"wss://a.example.com/k1"} (http://b.example.com?k=2)',
        "Failed (https://a.example.com/x). Max range: 1000.",
        "See https://a.example.com/key.",
        "https://[bad/secret",
        "custom_transport",
      ].join("\n"),
    ),
  ).toMatchInlineSnapshot(`
    "https://eth-mainnet.g.alchemy.com
    https://rpc.example.com:8545
    https://rpc.example.com
    wss://rpc.example.com
    http://localhost:8545
    URL: https://a.quiknode.pro
    Request body: {}
    {"url":"wss://a.example.com"} (http://b.example.com)
    Failed (https://a.example.com). Max range: 1000.
    See https://a.example.com.
    https://[redacted]
    custom_transport"
  `);
});

test("redactError keeps the error when a getter throws", () => {
  const error = new Error("https://rpc.example.com/secret");
  Object.defineProperty(error, "data", {
    enumerable: true,
    get() {
      throw new Error("getter");
    },
  });
  Object.defineProperty(error, "cause", {
    get() {
      throw new Error("getter");
    },
  });

  expect(redactError(error)).toBe(error);
  expect(error.message).toBe("https://rpc.example.com");
});

test("redactError", () => {
  const url = "https://rpc.example.com/v2/secret?key=secret";
  const cause = new HttpRequestError({
    body: { method: "eth_getLogs" },
    status: 500,
    url,
  });
  const error = new TimeoutError({ body: { method: "eth_getLogs" }, url });
  error.cause = cause;

  expect(redactError(error)).toBe(error);
  for (const e of [error, cause]) {
    expect(JSON.stringify(e)).not.toContain("secret");
    expect(e.message).not.toContain("secret");
    expect(e.stack).not.toContain("secret");
  }
  expect(error.message).toContain("URL: https://rpc.example.com\n");
  expect(cause.url).toBe("https://rpc.example.com");
});
