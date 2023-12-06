import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Inter } from "next/font/google";
import { formatEther } from "viem";
import { useAccount } from "wagmi";

import { useWethBalance } from "@/hooks/useBalance";

const inter = Inter({ subsets: ["latin"] });

export default function Home() {
  const { address } = useAccount();

  const wethBalance = useWethBalance(address);

  return (
    <main
      className={`flex min-h-screen flex-col items-center justify-between p-24 ${inter.className}`}
    >
      <div className="w-full max-w-md flex flex-col shadow-lg rounded-xl bg-blacka bg-opacity-60 p-4 gap-4">
        <div className="w-full flex gap-1 justify-between items-center">
          <ConnectButton />

          {wethBalance.status === "pending" ? (
            "Loading..."
          ) : wethBalance.status === "error" ? (
            <div className="">Error fetching balance</div>
          ) : (
            formatEther(wethBalance.data!)
          )}
        </div>
      </div>
    </main>
  );
}
