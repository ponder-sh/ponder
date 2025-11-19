import { useSchema } from "@/hooks/use-schema";
import { usePonderClient, usePonderQuery } from "@ponder/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

const LIMIT = 50;

function TableViewer() {
  const selectedTable = useSchema().data?.tables.json[0];
  const [page, setPage] = useState(1);

  // TODO(kyle) how to get query duration
  // const tableQuery = usePonderQuery({
  //   queryFn: (db) =>
  //     db.execute(
  //       `SELECT * FROM "${selectedTable?.tableName}" LIMIT ${LIMIT} OFFSET ${LIMIT * (page - 1)}`,
  //     ),
  //   enabled: !!selectedTable,
  //   staleTime: Number.POSITIVE_INFINITY,
  // });

  const client = usePonderClient();

  const tableQuery = useQuery({
    queryKey: ["table", selectedTable?.tableName ?? "", page],
    queryFn: () => {
      return client.db.execute(
        `SELECT * FROM "${selectedTable?.tableName}" LIMIT ${LIMIT} OFFSET ${LIMIT * (page - 1)}`,
      );
    },
    enabled: !!selectedTable,
    staleTime: Number.POSITIVE_INFINITY,
  });

  const countQuery = usePonderQuery({
    queryFn: (db) =>
      db.execute(`SELECT COUNT(*) FROM "${selectedTable?.tableName}"`),
    enabled: !!selectedTable,
    staleTime: Number.POSITIVE_INFINITY,
  });

  if (selectedTable === undefined) return <p>No table</p>;
  return (
    <div className="grid grid-rows-[56px_1fr]">
      <header className="flex justify-end p-3 text-brand-1 border-b-1 border-brand-2 items-center px-4 gap-2">
        {/* <button
          className="rounded-md border-2 border-brand-2 py-1 px-2 flex items-center"
          type="button"
        >
          Columns
        </button> */}
        {tableQuery.data && (
          <p className="text-sm">{tableQuery.data?.length} rows • 20ms</p>
        )}

        {countQuery.data && (
          <div className="rounded-md border-1 border-brand-2 min-w-[128px] h-[32px] items-center justify-between flex">
            <button
              type="button"
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
              className="disabled:cursor-not-allowed"
            >
              <img src="/chevron.svg" alt="back" className="" />
            </button>
            <div className="text-sm">
              <code>
                {page}/
                {Math.ceil((countQuery.data[0]!.count as number) / LIMIT)}
              </code>
            </div>
            <button
              type="button"
              disabled={
                page ===
                Math.ceil((countQuery.data[0]!.count as number) / LIMIT)
              }
              onClick={() => setPage(page + 1)}
              className="disabled:cursor-not-allowed"
            >
              <img src="/chevron.svg" alt="next" className="rotate-180" />
            </button>
          </div>
        )}

        <button
          type="button"
          title="Refresh rows"
          className="p-1 rounded-md border-1 border-brand-2 w-[32px] h-[32px] text-brand-2 cursor-pointer"
          onClick={() => tableQuery.refetch()}
        >
          <img src="/refresh.svg" alt="refresh" className="" />
        </button>
      </header>
      <div className="overflow-auto">
        <table className="table-fixed">
          <thead className="">
            <tr className="h-[32px]">
              {selectedTable.columns.map((column) => (
                <th
                  className="border-1 border-l-0 border-t-0 border-brand-2 min-w-[200px] max-w-[200px] text-xs font-semibold text-left px-2 truncate"
                  key={column.name}
                >
                  <code className="">
                    {column.name}{" "}
                    <code className="text-brand-1/60 font-normal">
                      {column.type}
                    </code>
                  </code>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="">
            {tableQuery.data?.map((row, index) => (
              <tr className="" key={index.toString()}>
                {selectedTable.columns.map((column) => (
                  <td
                    className="h-[32px] border-1 border-l-0 border-brand-2 min-w-[200px] max-w-[200px] text-xs text-left px-2 truncate"
                    key={column.name}
                  >
                    <code className="">{row[column.name]?.toString()}</code>
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
