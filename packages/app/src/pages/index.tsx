import { ConnectButton } from "@rainbow-me/rainbowkit";
import type { NextPage } from "next";

import { useExampleNFTContractRead } from "../contracts";
import { Inventory } from "../Inventory";
import { MintButton } from "../MintButton";
import { useIsMounted } from "../useIsMounted";

const HomePage: NextPage = () => {
  const totalSupply = useExampleNFTContractRead({
    functionName: "totalSupply",
    watch: true,
  });
  const maxSupply = useExampleNFTContractRead({ functionName: "MAX_SUPPLY" });

  const isMounted = useIsMounted();

  return (
    <div className="min-h-screen flex flex-col">
      <div className="self-end p-2">
        <ConnectButton />
      </div>
      <div className="flex-grow flex flex-col gap-4 items-center justify-center p-8 pb-[50vh]">
        <h1 className="text-4xl">Example NFT</h1>

        {/* Use isMounted to temporarily workaround hydration issues where
        server-rendered markup doesn't match the client due to localStorage
        caching in wagmi. See https://github.com/holic/web3-scaffold/pull/26 */}
        <p>
          {(isMounted ? totalSupply.data?.toNumber().toLocaleString() : null) ??
            "??"}
          /
          {(isMounted ? maxSupply.data?.toNumber().toLocaleString() : null) ??
            "??"}{" "}
          minted
        </p>

        <MintButton />
        <Inventory />
      </div>
    </div>
  );
};

export default HomePage;
