function Refresh({
  onClick,
}: {
  onClick: () => void;
}) {
  return (
    <div className="group relative">
      <button
        type="button"
        title="Refresh rows"
        className="p-1 rounded-md border-1 border-brand-2 w-[32px] h-[32px] text-brand-2 cursor-pointer"
        onClick={onClick}
      >
        <img src="/refresh.svg" alt="refresh" className="" />
      </button>
      <div className="text-sm absolute hidden group-hover:block bg-white border-1 rounded-md border-brand-2 right-0 left-auto whitespace-nowrap z-10 px-2 py-1 mt-1">
        Refresh rows
      </div>
    </div>
  );
}

export default Refresh;
