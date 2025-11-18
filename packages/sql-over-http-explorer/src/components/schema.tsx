import { useSchema } from "@/hooks/use-schema";
import { filterReorgTables } from "@/lib/drizzle-kit";

function Schema() {
  const schemaQuery = useSchema();

  return (
    <div className="flex justify-start flex-col gap-4">
      <div className="flex justify-start gap-2 items-center">
        <h2 className="flex justify-start text-sm font-semibold">Schema:</h2>
        <div className="rounded-md bg-brand-2 px-2 py-1 text-sm">
          <code>{schemaQuery.data?.schema}</code>
        </div>
      </div>
      <h2 className="flex justify-start text-sm font-semibold">Tables</h2>
      {schemaQuery.data && (
        <div className="flex items-start flex-col gap-2 ">
          {filterReorgTables(schemaQuery.data.tables.json).map((table) => (
            <div
              className="rounded-md bg-brand-2 px-2 py-1 text-sm"
              key={table.tableName}
            >
              <code>{table.tableName}</code>
            </div>
          ))}
        </div>
      )}

      {schemaQuery.data && schemaQuery.data.views.json.length > 0 && (
        <h2 className="flex justify-start text-sm font-semibold">Views</h2>
      )}
    </div>
  );
}

export default Schema;
