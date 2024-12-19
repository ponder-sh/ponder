import { Inter } from "next/font/google";
import CountUp from "react-countup";
import { formatEther } from "viem";

import { type Deposit, useDeposits } from "../hooks/useDeposits";

const inter = Inter({ subsets: ["latin"] });

export default function Home() {
  const deposits = useDeposits();

  return (
    <main
      className={`flex min-h-screen flex-col items-center justify-between pt-24 ${inter.className}`}
    >
      <div className="flex flex-col gap-6 p-4 w-full max-w-2xl">
        <h1 className="text-2xl font-bold">10 latest WETH mints</h1>

        <div className="flex flex-col gap-1 justify-between items-center w-full">
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

function Table({ deposits }: { deposits: Deposit[] }) {
  return (
    <ul className="w-full">
      <li className="grid grid-cols-2 w-full text-lg font-semibold sm:grid-cols-3">
        <p>Account</p>
        <p>Amount</p>
        <p className="hidden sm:flex">Timestamp</p>
      </li>
      {deposits.map(({ account, timestamp, amount }) => (
        <li
          className="grid grid-cols-2 py-2 w-full text-lg font-semibold sm:grid-cols-3"
          key={`${account}-${timestamp}`}
        >
          <a
            className="text-sm font-semibold text-blue-500 underline"
            href={`https://etherscan.io/address/${account}`}
          >
            {account.slice(0, 6)}...{account.slice(38)}
          </a>
          <CountUp
            start={0}
            end={Number(formatEther(amount))}
            duration={2.5}
            decimals={5}
            decimal={"."}
            separator={","}
            className="text-sm font-semibold"
          />
          <p className="hidden text-sm sm:flex">
            {new Date(timestamp * 1000).toLocaleString()}
          </p>
        </li>
      ))}
    </ul>
  );
}
