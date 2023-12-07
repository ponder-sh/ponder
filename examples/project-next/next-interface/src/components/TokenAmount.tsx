import CountUp from "react-countup";
import { formatEther } from "viem";

export default function TokenAmount({ amount }: { amount: bigint }) {
  return (
    <CountUp
      start={0}
      end={Number(formatEther(amount))}
      duration={2.5}
      decimals={5}
      decimal={"."}
      separator={","}
      className="text-sm font-semibold"
    />
  );
}
