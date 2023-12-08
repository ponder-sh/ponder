import { Inter } from "next/font/google";

import Table from "@/components/Table";
import { useDeposits } from "@/hooks/useDeposits";

const inter = Inter({ subsets: ["latin"] });

export default function Home() {
  const deposits = useDeposits();

  return (
    <main
      className={`flex min-h-screen flex-col items-center justify-between pt-24 ${inter.className}`}
    >
      <div className="w-full max-w-2xl flex flex-col p-4 gap-6">
        <h1 className="font-bold text-2xl">10 latest WETH mints</h1>

        <div className="w-full flex gap-1 flex-col justify-between items-center">
          {deposits.status === "pending" ? (
            <p className="font-semibold">Loading...</p>
          ) : deposits.status === "error" ? (
            <p className="font-semibold text-red-500">Error fetching mints</p>
          ) : (
            <Table deposits={deposits.data} />
          )}
        </div>
      </div>
    </main>
  );
}
