import type { JsonSchema } from "@/lib/drizzle-kit";
import { useEffect, useMemo, useState } from "react";

function ColumnSelection({
  selectedColumns,
  setSelectedColumns,
  table,
}: {
  selectedColumns: Set<string>;
  setSelectedColumns: (columns: Set<string>) => void;
  table: JsonSchema["tables"]["json"][number];
}) {
  const [isOpen, setIsOpen] = useState(false);

  const columns = useMemo(() => {
    return new Set(table.columns.map((column) => column.name));
  }, [table]);
  return (
    <div className="group relative">
      <button
        className="rounded-md border-1 border-brand-2 py-1 px-2 flex items-center gap-2"
        type="button"
        onClick={() => setIsOpen(true)}
      >
        <img src="/sliders-horizontal.svg" alt="play" className="" />

        <p className="text-sm">Columns</p>
        {selectedColumns.size > 0 && selectedColumns.size < columns.size && (
          <span className="absolute top-0 right-0 h-2 w-2 rounded-full bg-blue-500 transform translate-x-1/4 -translate-y-1/4" />
        )}
      </button>
      {isOpen && (
        <div className="flex flex-col  absolute min-w-[200px] bg-white border-1 rounded-md border-brand-2 whitespace-nowrap z-10 py-1 mt-1">
          <div className="flex w-full justify-between items-center border-b-1 border-brand-2 px-2 pt-1 pb-2">
            <p className="text-xs">Select columns</p>
            <button
              className="text-xs font-bold cursor-pointer"
              type="button"
              onClick={() => setSelectedColumns(new Set(columns))}
            >
              Select all
            </button>
          </div>
          <div>
            {Array.from(columns).map((column) => (
              <div key={column} className="mx-2 my-1 flex items-center gap-1">
                <div className="min-w-3 min-h-3">
                  {selectedColumns.has(column) ? "y" : "n"}
                </div>
                <code className="text-xs">{column}</code>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default ColumnSelection;
