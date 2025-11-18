import "./App.css";

function App() {
  return (
    <div className="grid grid-cols-[200px_1fr] min-h-screen">
      <aside className="p-4 border-r-1 border-brand-2">
        <img
          src="/ponder-light.svg"
          alt="Ponder Logo"
          className="h-6 self-start mb-4"
        />
        {/* navigation */}
      </aside>
      <div className="grid grid-rows-[56px_1fr]">
        <header className="flex justify-start p-3 text-brand-1 border-b-1 border-brand-2">
          <button
            className="rounded-md border-2 border-brand-2 py-1 px-2 flex items-center"
            type="button"
          >
            Columns
          </button>
        </header>
        {/* main content */}
      </div>
    </div>
  );
}

export default App;
