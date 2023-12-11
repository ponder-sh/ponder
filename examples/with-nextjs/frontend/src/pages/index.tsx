import { Inter } from "next/font/google";
import { formatEther } from "viem";
import CountUp from "react-countup";

import { useDeposits, type Deposit } from "../hooks/useDeposits";

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

function Table({ deposits }: { deposits: Deposit[] }) {
  return (
    <ul className="w-full">
      <li className="w-full grid grid-cols-2 font-semibold text-lg sm:grid-cols-3">
        <p>Account</p>
        <p>Amount</p>
        <p className="hidden sm:flex">Timestamp</p>
      </li>
      {deposits.map(({ id, account, timestamp, amount }) => (
        <li
          className="w-full grid grid-cols-2 sm:grid-cols-3 font-semibold text-lg py-2"
          key={id}
        >
          <a
            className="text-blue-500 text-sm font-semibold underline"
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
          <p className="text-sm hidden sm:flex">
            {new Date(timestamp * 1000).toLocaleString()}
          </p>
        </li>
      ))}
    </ul>
  );
}
