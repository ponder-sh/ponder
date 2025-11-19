function TableHeaderCell({
  column,
  orderBy,
  setOrderBy,
}: {
  column: any;
  orderBy: {
    columnName: string;
    direction: "asc" | "desc";
  } | null;
  setOrderBy: (
    orderBy: {
      columnName: string;
      direction: "asc" | "desc";
    } | null,
  ) => void;
}) {
  const isOrderDesc =
    orderBy?.columnName === column.name && orderBy?.direction === "desc";
  const isOrderAsc =
    orderBy?.columnName === column.name && orderBy?.direction === "asc";

  return (
    <th className="border-1 border-l-0 border-t-0 border-brand-2 min-w-[200px] max-w-[200px] text-xs font-semibold text-left px-2">
      <div className="flex w-full items-center justify-between">
        <div className="truncate">
          <code className="">{column.name}</code>{" "}
          <code className="text-brand-1/60 font-normal">{column.type}</code>
        </div>
        {isOrderDesc ? (
          <button
            type="button"
            onClick={() =>
              setOrderBy({ columnName: column.name, direction: "asc" })
            }
            className="cursor-pointer"
          >
            <img
              src="/arrow-up-narrow-wide.svg"
              alt="copy"
              className="w-3 min-w-3 h-3 min-h-3"
            />
          </button>
        ) : isOrderAsc ? (
          <button
            type="button"
            onClick={() =>
              setOrderBy({ columnName: column.name, direction: "desc" })
            }
            className="cursor-pointer"
          >
            <img
              src="/arrow-down-wide-narrow.svg"
              alt="copy"
              className="w-3 min-w-3 h-3 min-h-3"
            />
          </button>
        ) : (
          <button
            type="button"
            onClick={() =>
              setOrderBy({ columnName: column.name, direction: "desc" })
            }
            className="cursor-pointer"
          >
            <img
              src="/chevrons-up-down.svg"
              alt="copy"
              className="w-3 min-w-3 h-3 min-h-3"
            />
          </button>
        )}
      </div>
    </th>
  );
}

export default TableHeaderCell;
