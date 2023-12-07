import Address from "./Address";
import TokenAmount from "./TokenAmount";

type Transfer = {
  from: string;
  to: string;
  timestamp: number;
  amount: bigint;
};

export default function Table({ transfers }: { transfers: Transfer[] }) {
  return (
    <ul className="w-full gap-3 p-2">
      <li className="w-full grid grid-cols-3 font-semibold text-lg gap-2 sm:grid-cols-4">
        <p>From</p>
        <p>To</p>
        <p>Amount</p>
        <p className="hidden sm:flex justify-end">Timestamp</p>
      </li>
      {transfers.map((t) => (
        <li
          className="w-full grid grid-cols-3 font-semibold text-lg py-2 sm:grid-cols-4"
          key={`${t.from}-${t.to}-${t.amount}-${t.timestamp}`}
        >
          <Address address={t.from} />
          <Address address={t.to} />
          <TokenAmount amount={t.amount} />
          <p className="text-sm hidden sm:flex justify-end w-full break-all overflow-auto text-right h-4">
            {new Date(t.timestamp * 1000).toLocaleString()}
          </p>
        </li>
      ))}
    </ul>
  );
}
