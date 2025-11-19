import { useReady } from "@/hooks/use-ready";
import { useSchema } from "@/hooks/use-schema";
import type { JsonSchema } from "@/lib/drizzle-kit";
import {
  getPonderQueryOptions,
  usePonderClient,
  usePonderQuery,
} from "@ponder/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

const LIMIT = 50;

function TableViewer() {
  const ready = useReady();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);

  const tables = useSchema().data?.tables.json;
  const [searchParams, setSearchParams] = useSearchParams();

  let table: JsonSchema["tables"]["json"][number] | undefined;
  if (tables !== undefined) {
    if (searchParams.get("table")) {
      table = tables.find((t) => t.tableName === searchParams.get("table"));
    } else {
      table = tables[0];
      if (table) {
        setSearchParams({ table: table.tableName });
      }
    }
  }

  const client = usePonderClient();

  const queryFn = useCallback(() => {
    return client.db.execute(
      `SELECT * FROM "${table?.tableName}" LIMIT ${LIMIT} OFFSET ${LIMIT * (page - 1)}`,
    );
  }, [client, table?.tableName, page]);

  const queryOptions = useMemo(
    () => getPonderQueryOptions(client, queryFn),
    [client, queryFn],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
  useEffect(() => {
    if (!ready.data || !table) return;

    const { unsubscribe } = client.live(queryOptions.queryFn, (data) => {
      queryClient.setQueryData(queryOptions.queryKey, {
        result: data,
        duration:
          // @ts-ignore
          queryClient.getQueryData(queryOptions.queryKey)?.duration ?? 0,
      });
    });
    return unsubscribe;
  }, [page, ready.data, table, client, queryClient]);

  const tableQuery = useQuery({
    queryKey: queryOptions.queryKey,
    queryFn: async () => {
      const start = performance.now();
      const result = await queryOptions.queryFn();
      const end = performance.now();
      return {
        result: result,
        duration: end - start,
      };
    },
    enabled: !!table,
    staleTime: Number.POSITIVE_INFINITY,
  });

  const countQuery = usePonderQuery({
    queryFn: (db) => {
      return db.execute(`SELECT COUNT(*) FROM "${table?.tableName}"`);
    },
    enabled: !!table,
    live: !!table && ready.data === true,
    staleTime: Number.POSITIVE_INFINITY,
  });

  if (table === undefined) return <p>No table</p>;
  return (
    <div className="grid grid-rows-[56px_1fr]">
      <header className="flex justify-between p-3 border-b-1 border-brand-2 items-center px-4 min-w-[600px]">
        <div className="">
          {ready.data !== undefined && (
            <div
              className="text-sm font-semibold border-1 rounded-md px-2 py-1"
              style={{
                borderColor: ready.data ? "green" : "var(--color-brand-1)",
                color: ready.data ? "green" : "var(--color-brand-1)",
              }}
            >
              {ready.data ? "Live" : "Backfilling..."}
            </div>
          )}
        </div>

        {/* <button
          className="rounded-md border-2 border-brand-2 py-1 px-2 flex items-center"
          type="button"
        >
          Columns
        </button> */}
        <div className="flex items-center gap-2">
          {tableQuery.data && (
            <p className="text-sm">
              {tableQuery.data.result.length} rows •{" "}
              {tableQuery.data.duration.toFixed(2)}ms
            </p>
          )}

          {countQuery.data && (
            <div className="rounded-md border-1 border-brand-2 h-[32px] items-center justify-between flex">
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
                  {Math.max(
                    Math.ceil((countQuery.data[0]!.count as number) / LIMIT),
                    1,
                  )}
                </code>
              </div>
              <button
                type="button"
                disabled={
                  page ===
                  Math.min(
                    Math.ceil((countQuery.data[0]!.count as number) / LIMIT),
                    1,
                  )
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
            onClick={() => {
              tableQuery.refetch();
              countQuery.refetch();
            }}
          >
            <img src="/refresh.svg" alt="refresh" className="" />
          </button>
        </div>
      </header>
      <div className="overflow-auto">
        <table className="table-fixed">
          <thead className="">
            <tr className="h-[32px]">
              {table.columns.map((column) => (
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
            {tableQuery.data?.result.map((row) => (
              // TODO(kyle) don't flash on mount
              <tr
                className=""
                style={{
                  animation:
                    ready.data === true ? "flash-blue 1s ease-in-out" : "",
                }}
                key={Object.values(row).join("_")}
              >
                {table?.columns.map((column) => (
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
