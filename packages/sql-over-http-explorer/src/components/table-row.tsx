import type { JsonSchema } from "@/lib/drizzle-kit";
import TableCell from "./table-cell";
import type { SelectedCell } from "./table-viewer";

function TableRow({
  ready,
  row,
  table,
  selectedCell,
  setSelectedCell,
}: {
  ready: boolean | undefined;
  row: Record<string, unknown>;
  table: JsonSchema["tables"]["json"][number];
  selectedCell: SelectedCell | null;
  setSelectedCell: (cell: SelectedCell | null) => void;
}) {
  const rowId = Object.values(row).join("_");
  return (
    <tr
      className="hover:bg-brand-2/20"
      style={{
        animation: ready === true ? "flash-blue 1s ease-in-out" : "",
      }}
      key={rowId}
    >
      {table?.columns.map((column) => (
        <TableCell
          key={column.name}
          row={row}
          column={column}
          selectedCell={selectedCell}
          setSelectedCell={setSelectedCell}
        />
      ))}
    </tr>
  );
}

export default TableRow;
