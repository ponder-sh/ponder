import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import { zeroAddress } from "viem";
import type { AppRouter } from "../ponder/src/api/index";

const client = createTRPCProxyClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "http://localhost:42069/trpc",
    }),
  ],
});

const response = await client.hello.query(zeroAddress);

console.log(response);
