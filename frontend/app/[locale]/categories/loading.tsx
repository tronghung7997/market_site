/** Route-level skeleton so a client-side navigation to /categories paints the
 *  page structure immediately instead of waiting for the server render. */
export default function CategoriesLoading() {
  return (
    <div className="mx-auto w-full max-w-[1240px] animate-pulse px-4 py-6 sm:px-6 sm:py-8" aria-busy="true">
      <div className="flex flex-col justify-between gap-4 border-b border-line pb-6 md:flex-row md:items-end">
        <div className="space-y-2">
          <div className="h-3.5 w-28 rounded bg-raised" />
          <div className="h-8 w-56 rounded bg-raised" />
          <div className="h-3.5 w-80 max-w-full rounded bg-raised" />
        </div>
        <div className="h-10 w-full rounded-xl bg-raised md:w-[320px]" />
      </div>
      <div className="mt-5 flex gap-2">
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-8 w-24 rounded-full bg-raised" />)}
      </div>
      <div className="mt-6 space-y-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="overflow-hidden rounded-xl border border-line bg-surface">
            <div className="flex items-center gap-3.5 border-b border-line p-4 sm:p-5">
              <div className="h-11 w-11 rounded-xl bg-raised" />
              <div className="space-y-2"><div className="h-5 w-40 rounded bg-raised" /><div className="h-3 w-24 rounded bg-raised" /></div>
            </div>
            <div className="grid grid-cols-1 gap-3.5 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, j) => <div key={j} className="h-40 rounded-xl bg-raised" />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
