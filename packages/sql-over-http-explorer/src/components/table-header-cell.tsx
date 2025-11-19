function TableHeaderCell({
  column,
}: {
  column: any;
}) {
  return (
    <th className="border-1 border-l-0 border-t-0 border-brand-2 min-w-[200px] max-w-[200px] text-xs font-semibold text-left px-2 truncate">
      <code className="">
        {column.name}{" "}
        <code className="text-brand-1/60 font-normal">{column.type}</code>
      </code>
    </th>
  );
}

export default TableHeaderCell;
