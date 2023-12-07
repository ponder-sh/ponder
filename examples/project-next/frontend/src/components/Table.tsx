import Address from "./Address";
import TokenAmount from "./TokenAmount";

type Deposit = {
  id: string;
  account: string;
  timestamp: number;
  amount: bigint;
};

export default function Table({ deposits }: { deposits: Deposit[] }) {
  return (
    <ul className="w-full">
      <li className="w-full grid grid-cols-2 font-semibold text-lg sm:grid-cols-3">
        <p>Account</p>
        <p>Amount</p>
        <p className="hidden sm:flex">Timestamp</p>
      </li>
      {deposits.map((d) => (
        <li
          className="w-full grid grid-cols-2 sm:grid-cols-3 font-semibold text-lg py-2"
          key={d.id}
        >
          <Address address={d.account} />
          <TokenAmount amount={d.amount} />
          <p className="text-sm hidden sm:flex">
            {new Date(d.timestamp * 1000).toLocaleString()}
          </p>
        </li>
      ))}
    </ul>
  );
}
