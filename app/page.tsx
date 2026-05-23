export default function Home() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between border-b border-slate-200 pb-4">
          <h1 className="text-2xl font-semibold tracking-tight">JobRadar</h1>
          <button
            className="rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white shadow-sm"
            type="button"
          >
            Sync Jobs
          </button>
        </header>

        <section className="flex flex-1 items-center justify-center py-16">
          <div className="max-w-md text-center">
            <h2 className="text-xl font-semibold">Personal job tracker setup</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              The database, sync adapters, filters, and status actions will be
              layered onto this one-page workspace.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
