import { bench, group, run } from "mitata";
import { checksumAddress as viemChecksumAddress } from "viem";
import { checksumAddress } from "./checksumAddress.js";

const address = "0x95222290dd7278aa3ddd389cc1e1d165cc4bafe5";

checksumAddress(address);

group(() => {
  bench("viem", () => viemChecksumAddress(address));
  bench("cache", () => checksumAddress(address));
});

run();
