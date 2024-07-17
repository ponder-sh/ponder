import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "../ponder/src/api/index";

const client = createTRPCProxyClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "http://localhost:42069/trpc",
    }),
  ],
});

const response = await client.hello.query(
  //  ^?
  "0xC1894e6a52c4C7Ac5b2e0b25583Ea48bf45DA14a",
);

console.log(response);
