import { createPublicClient, fallback, http, webSocket } from "viem";
import { mainnet } from "viem/chains";
import { describe, expect, it } from "vitest";

import { getDefaultMaxBlockRange, getTransportUrls } from "./networks";

describe("network tests", () => {
  describe("getTransportUrls tests", () => {
    it("should return the http url", () => {
      const url = "http://localhost:8545";

      const client = createPublicClient({
        transport: http(url),
        chain: {
          ...mainnet,
          name: "mainnet",
          id: 1,
          network: "mainnet",
        },
      });
      const rpcUrls = getTransportUrls(client);
      expect(rpcUrls).toContain(url);
      expect(rpcUrls).toHaveLength(1);
    });

    it("should return the http url of the fallback transport", () => {
      const url = "http://localhost:8545";

      const client = createPublicClient({
        transport: fallback([webSocket(url), http(url)]),
        chain: {
          ...mainnet,
          name: "mainnet",
          id: 1,
          network: "mainnet",
        },
      });
      const rpcUrls = getTransportUrls(client);
      expect(rpcUrls).toContain(url);
      expect(rpcUrls).toHaveLength(1);
    });

    it("should return both http url of the transport", () => {
      const url = "http://localhost:8545";

      const client = createPublicClient({
        transport: fallback([http(url), http(url)]),
        chain: {
          ...mainnet,
          name: "mainnet",
          id: 1,
          network: "mainnet",
        },
      });
      const rpcUrls = getTransportUrls(client);
      expect(rpcUrls).toContain(url);
      expect(rpcUrls).toHaveLength(2);
    });
  });

  describe("getDefaultMaxBlockRange tests", () => {
    it("should return 2000 mainnet", () => {
      const client = createPublicClient({
        transport: http("http://localhost:8545"),
        chain: {
          ...mainnet,
          name: "mainnet",
          id: 1,
          network: "mainnet",
        },
      });
      const maxBlockRange = getDefaultMaxBlockRange(
        {
          chainId: 1,
        },
        client
      );
      expect(maxBlockRange).toBe(2000);
    });

    it("should return 50000 optimism", () => {
      const client = createPublicClient({
        transport: http("http://localhost:8545"),
        chain: {
          ...mainnet,
          name: "mainnet",
          id: 1,
          network: "mainnet",
        },
      });
      const maxBlockRange = getDefaultMaxBlockRange(
        {
          chainId: 10,
        },
        client
      );
      expect(maxBlockRange).toBe(50000);
    });

    it("should return 10000 quicknode", () => {
      const client = createPublicClient({
        transport: http("http://quicknode"),
        chain: {
          ...mainnet,
          name: "mainnet",
          id: 1,
          network: "mainnet",
        },
      });
      const maxBlockRange = getDefaultMaxBlockRange(
        {
          chainId: 10,
        },
        client
      );
      expect(maxBlockRange).toBe(10000);
    });

    it("should return 2000 quicknode mainnet", () => {
      const client = createPublicClient({
        transport: http("http://quicknode"),
        chain: {
          ...mainnet,
          name: "mainnet",
          id: 1,
          network: "mainnet",
        },
      });
      const maxBlockRange = getDefaultMaxBlockRange(
        {
          chainId: 1,
        },
        client
      );
      expect(maxBlockRange).toBe(2000);
    });
  });
});
