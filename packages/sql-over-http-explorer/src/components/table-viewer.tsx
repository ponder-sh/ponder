import { useSchema } from "@/hooks/use-schema";

function TableViewer() {
  const selectedTable = useSchema().data?.tables.json[0];
  return (
    <div className="grid grid-rows-[56px_1fr]">
      <header className="flex justify-start p-3 text-brand-1 border-b-1 border-brand-2">
        <button
          className="rounded-md border-2 border-brand-2 py-1 px-2 flex items-center"
          type="button"
        >
          Columns
        </button>
      </header>
      <p>Table Viewer</p>
      <pre>{JSON.stringify(selectedTable, null, 2)}</pre>
    </div>
  );
}

export default TableViewer;

// type Person = {
//   firstName: string;
//   lastName: string;
//   age: number;
//   visits: number;
//   status: string;
//   progress: number;
// };

// const defaultData: Person[] = [
//   {
//     firstName: "tanner",
//     lastName: "linsley",
//     age: 24,
//     visits: 100,
//     status: "In Relationship",
//     progress: 50,
//   },
//   {
//     firstName: "tandy",
//     lastName: "miller",
//     age: 40,
//     visits: 40,
//     status: "Single",
//     progress: 80,
//   },
//   {
//     firstName: "joe",
//     lastName: "dirte",
//     age: 45,
//     visits: 20,
//     status: "Complicated",
//     progress: 10,
//   },
// ];

// const columnHelper = createColumnHelper<Person>()

// const columns = [
//   columnHelper.accessor('firstName', {
//     cell: info => info.getValue(),
//     footer: info => info.column.id,
//   }),
//   columnHelper.accessor(row => row.lastName, {
//     id: 'lastName',
//     cell: info => <i>{info.getValue()}</i>,
//     header: () => <span>Last Name</span>,
//     footer: info => info.column.id,
//   }),
//   columnHelper.accessor('age', {
//     header: () => 'Age',
//     cell: info => info.renderValue(),
//     footer: info => info.column.id,
//   }),
//   columnHelper.accessor('visits', {
//     header: () => <span>Visits</span>,
//     footer: info => info.column.id,
//   }),
//   columnHelper.accessor('status', {
//     header: 'Status',
//     footer: info => info.column.id,
//   }),
//   columnHelper.accessor('progress', {
//     header: 'Profile Progress',
//     footer: info => info.column.id,
//   }),
// ]
