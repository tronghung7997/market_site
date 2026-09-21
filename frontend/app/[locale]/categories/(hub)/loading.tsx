/** Route-level skeleton in the explorer's shape (rail + rows) so a client-side
 *  navigation into /categories or a category paints its structure at once. */
export default function CategoriesLoading() {
  return (
    <div className="mx-auto w-full max-w-[1200px] animate-pulse px-4 py-6 sm:px-6 sm:py-8" aria-busy="true">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div className="space-y-2">
          <div className="h-8 w-56 rounded bg-raised" />
          <div className="h-3.5 w-72 max-w-full rounded bg-raised" />
        </div>
        <div className="h-10 w-full rounded-lg bg-raised sm:w-[300px]" />
      </div>
      <div className="mt-6 sm:mt-8 lg:grid lg:grid-cols-[224px_minmax(0,1fr)] lg:gap-10">
        <div className="mb-5 flex gap-2 lg:mb-0 lg:block lg:space-y-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-9 w-28 rounded-lg bg-raised lg:w-full" />
          ))}
        </div>
        <div className="space-y-10">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i}>
              <div className="mb-3 flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-raised" />
                <div className="space-y-1.5"><div className="h-5 w-40 rounded bg-raised" /><div className="h-3 w-24 rounded bg-raised" /></div>
              </div>
              <div className="divide-y divide-line rounded-xl border border-line bg-surface">
                {Array.from({ length: 3 }).map((_, j) => (
                  <div key={j} className="flex items-center gap-4 px-4 py-3">
                    <div className="h-11 w-11 rounded-lg bg-raised" />
                    <div className="flex-1 space-y-1.5"><div className="h-4 w-1/2 rounded bg-raised" /><div className="h-3 w-1/3 rounded bg-raised" /></div>
                    <div className="h-4 w-16 rounded bg-raised" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
