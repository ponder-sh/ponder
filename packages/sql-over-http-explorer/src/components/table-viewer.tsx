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
import PageSelector from "./page-selector";
import Pause from "./pause";
import Refresh from "./refresh";
import Status from "./status";
import TableHeaderCell from "./table-header-cell";
import TableRow from "./table-row";
// import ColumnSelection from "./column-selection";

export const LIMIT = 50;

export type SelectedCell = {
  rowId: string;
  columnName: string;
};

function TableViewer() {
  const ready = useReady();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [paused, setPaused] = useState(false);
  const [selectedCell, setSelectedCell] = useState<SelectedCell | null>(null);
  // const [selectedColumns, setSelectedColumns] = useState<Set<string>>(
  //   new Set(),
  // );

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

  useEffect(() => {
    if (!ready.data || !table || paused) return;

    const { unsubscribe } = client.live(queryOptions.queryFn, (data) => {
      queryClient.setQueryData(queryOptions.queryKey, {
        result: data,
        duration:
          // @ts-ignore
          queryClient.getQueryData(queryOptions.queryKey)?.duration ?? 0,
      });
    });
    return unsubscribe;
  }, [
    ready.data,
    table,
    client,
    queryClient,
    paused,
    queryOptions.queryFn,
    queryOptions.queryKey,
  ]);

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
    live: ready.data === true && paused === false,
    staleTime: Number.POSITIVE_INFINITY,
  });

  if (table === undefined) return <p>No table</p>;
  return (
    <div className="grid grid-rows-[56px_1fr]">
      <header className="flex justify-between p-3 border-b-1 border-brand-2 items-center px-4 min-w-[600px]">
        <div className="flex gap-2 items-center">
          {ready.data !== undefined && <Status ready={ready.data} />}
          {ready.data === true && (
            <Pause paused={paused} setPaused={setPaused} />
          )}
          {/* <ColumnSelection
            selectedColumns={selectedColumns}
            setSelectedColumns={setSelectedColumns}
            table={table}
          /> */}
        </div>

        <div className="flex items-center gap-2">
          {tableQuery.data && (
            <p className="text-sm">
              {tableQuery.data.result.length} rows •{" "}
              {tableQuery.data.duration.toFixed(2)}ms
            </p>
          )}

          {countQuery.data && (
            <PageSelector
              page={page}
              setPage={setPage}
              count={countQuery.data[0]!.count as number}
            />
          )}

          <Refresh
            onClick={() => {
              tableQuery.refetch();
              countQuery.refetch();
            }}
          />
        </div>
      </header>
      <div className="overflow-auto">
        <table className="table-fixed">
          <thead className="">
            <tr className="h-[32px]">
              {table.columns.map((column) => (
                <TableHeaderCell key={column.name} column={column} />
              ))}
            </tr>
          </thead>
          <tbody className="">
            {tableQuery.data?.result.map((row) => {
              const rowId = Object.values(row).join("_");

              return (
                <TableRow
                  ready={ready.data}
                  row={row}
                  table={table!}
                  selectedCell={selectedCell}
                  setSelectedCell={setSelectedCell}
                  key={rowId}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default TableViewer;
