import { useMemo, useRef } from "react";
import type { SelectedCell } from "./table-viewer";

function TableCell({
  row,
  column,
  selectedCell,
  setSelectedCell,
}: {
  row: Record<string, unknown>;
  column: any;
  selectedCell: SelectedCell | null;
  setSelectedCell: (cell: SelectedCell | null) => void;
}) {
  const contentRef = useRef<HTMLElement>(null);

  const rowId = Object.values(row).join("_");
  const isSelected =
    selectedCell?.rowId === rowId && selectedCell?.columnName === column.name;

  // TODO(kyle) multiline

  const isTruncated = useMemo(() => {
    const contentElement = contentRef.current;
    if (contentElement) {
      return contentElement.scrollWidth > contentElement.offsetWidth;
    }
    return false;
  }, []);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: <explanation>
    <td
      className="h-[32px] border-1 border-l-0 border-brand-2 min-w-[200px] max-w-[200px] px-2 cursor-pointer"
      onClick={() => setSelectedCell({ rowId, columnName: column.name })}
      onDoubleClick={() => {
        console.log(isTruncated);
      }}
      style={{
        backgroundColor: isSelected ? "#3b83f680" : "transparent",
      }}
    >
      <code
        ref={contentRef}
        className="block min-w-full max-w-full truncate text-xs text-left"
      >
        {row[column.name]?.toString()}
      </code>
    </td>
  );
}

export default TableCell;
