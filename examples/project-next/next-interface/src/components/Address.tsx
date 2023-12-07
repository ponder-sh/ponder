export default function Address({ address }: { address: string }) {
  return (
    <a
      className="text-blue-500 text-sm font-semibold underline"
      href={`https://sepolia.etherscan.io/address/${address}`}
    >
      {address.slice(0, 6)}...{address.slice(38)}
    </a>
  );
}
