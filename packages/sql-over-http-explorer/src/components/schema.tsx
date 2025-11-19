import { useSchema } from "@/hooks/use-schema";
import { filterReorgTables } from "@/lib/drizzle-kit";
import { useSearchParams } from "react-router-dom";

function Schema() {
  const schemaQuery = useSchema();
  const [searchParams, setSearchParams] = useSearchParams();

  return (
    <div className="flex justify-start flex-col gap-4">
      <div className="flex justify-start gap-2 items-center">
        <h2 className="flex justify-start text-sm font-semibold">Schema</h2>
        <div className="flex rounded-md bg-brand-2 px-2 py-1 text-sm mr-4">
          <code className="truncate max-w-[90px]">
            {schemaQuery.data?.schema}
          </code>
        </div>
      </div>
      <h2 className="flex justify-start text-sm font-semibold">Tables</h2>
      {schemaQuery.data && (
        <div className="flex items-start flex-col gap-2 ">
          {filterReorgTables(schemaQuery.data.tables.json).map((table) => (
            <button
              type="button"
              className="cursor-pointer"
              key={table.tableName}
              onClick={() => {
                setSearchParams({ table: table.tableName });
              }}
            >
              <div
                className="flex items-center gap-2 rounded-md px-2 py-1 text-sm"
                key={table.tableName}
                style={{
                  backgroundColor:
                    searchParams.get("table") === table.tableName
                      ? "var(--color-brand-2)"
                      : "transparent",
                }}
              >
                <code className="truncate max-w-[152px]">
                  {table.tableName}
                </code>
              </div>
            </button>
          ))}
        </div>
      )}

      {schemaQuery.data && schemaQuery.data.views.json.length > 0 && (
        <>
          <h2 className="flex justify-start text-sm font-semibold">Views</h2>
          <div className="flex items-start flex-col gap-2 ">
            {schemaQuery.data.views.json.map((view) => (
              <button
                type="button"
                className="cursor-pointer"
                key={view.name}
                onClick={() => {
                  setSearchParams({ table: view.name });
                }}
              >
                <div
                  className="flex items-center gap-2 rounded-md px-2 py-1 text-sm"
                  key={view.name}
                  style={{
                    backgroundColor:
                      searchParams.get("table") === view.name
                        ? "var(--color-brand-2)"
                        : "transparent",
                  }}
                >
                  <code className="truncate max-w-[152px]">{view.name}</code>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default Schema;
