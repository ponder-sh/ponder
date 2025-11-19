import { LIMIT } from "./table-viewer";

function PageSelector({
  page,
  setPage,
  count,
}: { page: number; setPage: (page: number) => void; count: number }) {
  return (
    <div className="rounded-md border-1 border-brand-2 h-[32px] items-center justify-between flex">
      <button
        type="button"
        disabled={page === 1}
        onClick={() => setPage(page - 1)}
        className="cursor-pointer disabled:cursor-not-allowed"
      >
        <img src="/chevron.svg" alt="back" className="" />
      </button>
      <div className="text-sm">
        <code>
          {page}/{Math.max(Math.ceil((count as number) / LIMIT), 1)}
        </code>
      </div>
      <button
        type="button"
        disabled={page === Math.max(Math.ceil((count as number) / LIMIT), 1)}
        onClick={() => setPage(page + 1)}
        className="cursor-pointer disabled:cursor-not-allowed"
      >
        <img src="/chevron.svg" alt="next" className="rotate-180" />
      </button>
    </div>
  );
}

export default PageSelector;
