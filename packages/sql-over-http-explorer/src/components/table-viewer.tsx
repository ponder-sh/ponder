import { useSchema } from "@/hooks/use-schema";
import { usePonderQuery } from "@ponder/react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useMemo } from "react";

function TableViewer() {
  const selectedTable = useSchema().data?.tables.json[0];

  const tableQuery = usePonderQuery({
    queryFn: (db) =>
      db.execute(`SELECT * FROM "${selectedTable?.tableName}" LIMIT 50`),
    enabled: !!selectedTable,
    staleTime: Number.POSITIVE_INFINITY,
  });

  if (selectedTable === undefined) return null;

  const columnHelper = createColumnHelper();

  const columns = useMemo<any>(() => {
    return selectedTable?.columns.map((column) => {
      console.log(column.name);
      return columnHelper.accessor(column.name, {
        // @ts-ignore
        cell: (info) => <code className="">{info.getValue().toString()}</code>,
        header: () => <code className="">{column.name}</code>,
      });
    });
  }, [selectedTable, columnHelper]);

  const table = useReactTable({
    data: tableQuery.data ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="grid grid-rows-[56px_1fr]">
      <header className="flex justify-start p-3 text-brand-1 border-b-1 border-brand-2">
        {/* <button
          className="rounded-md border-2 border-brand-2 py-1 px-2 flex items-center"
          type="button"
        >
          Columns
        </button> */}
      </header>
      <div className="overflow-auto">
        <table className="table-fixed">
          <thead className="">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr className="h-[32px]" key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    className="border-1 border-l-0 border-t-0 border-brand-2 min-w-[200px] text-xs font-semibold text-left px-2"
                    key={header.id}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="">
            {table.getRowModel().rows.map((row) => (
              <tr className="" key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <td
                    className="h-[32px] border-1 border-l-0 border-brand-2 min-w-[200px] text-xs text-left px-2"
                    key={cell.id}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default TableViewer;
