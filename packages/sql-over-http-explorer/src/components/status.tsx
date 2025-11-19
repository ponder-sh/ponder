function Status({
  ready,
}: {
  ready: boolean;
}) {
  return (
    <div
      className="text-sm font-semibold border-1 rounded-md px-2 py-1"
      style={{
        borderColor: ready ? "green" : "var(--color-brand-1)",
        color: ready ? "green" : "var(--color-brand-1)",
      }}
    >
      {ready ? "Live" : "Backfilling..."}
    </div>
  );
}

export default Status;
