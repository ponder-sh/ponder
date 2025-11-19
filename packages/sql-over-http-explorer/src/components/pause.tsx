function Pause({
  paused,
  setPaused,
}: {
  paused: boolean;
  setPaused: (paused: boolean) => void;
}) {
  return (
    <div className="group relative">
      {paused === false ? (
        <>
          <button
            type="button"
            title="Pause live queries"
            className="p-1 rounded-md border-1 border-brand-2 w-[32px] h-[32px] text-brand-2 cursor-pointer"
            onClick={() => {
              setPaused(true);
            }}
          >
            <img src="/pause.svg" alt="pause" className="" />
          </button>
          <div className="text-sm absolute hidden group-hover:block bg-white border-1 rounded-md border-brand-2 whitespace-nowrap z-10 px-2 py-1 mt-1">
            Pause live queries
          </div>
        </>
      ) : (
        <>
          <button
            type="button"
            title="Pause live queries"
            className="p-1 rounded-md border-1 border-brand-2 w-[32px] h-[32px] text-brand-2 cursor-pointer"
            onClick={() => {
              setPaused(false);
            }}
          >
            <img src="/play.svg" alt="play" className="" />
          </button>
          <div className="text-sm absolute hidden group-hover:block bg-white border-1 rounded-md border-brand-2 whitespace-nowrap z-10 px-2 py-1 mt-1">
            Resume live queries
          </div>
        </>
      )}
    </div>
  );
}

export default Pause;
