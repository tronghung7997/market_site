/** Layout-shaped placeholder while the results page renders on the server. */
export default function SearchLoading() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6 sm:py-8" aria-busy>
      <div className="mb-5 space-y-2">
        <div className="h-3 w-16 rounded bg-raised animate-pulse" />
        <div className="h-8 w-2/3 max-w-md rounded bg-raised animate-pulse" />
        <div className="h-3.5 w-1/3 max-w-xs rounded bg-raised animate-pulse" />
      </div>
      <div className="mb-6 flex flex-col gap-3 md:flex-row">
        <div className="h-10 flex-1 rounded-lg bg-raised animate-pulse" />
        <div className="h-10 w-24 rounded-lg bg-raised animate-pulse" />
        <div className="h-10 w-40 rounded-lg bg-raised animate-pulse" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="space-y-4">
          <div className="h-40 rounded-card bg-raised animate-pulse" />
          <div className="h-28 rounded-card bg-raised animate-pulse" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-56 rounded-card bg-raised animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  );
}
