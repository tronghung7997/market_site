/** Product-pane skeleton (toolbar + grid). The header and rail belong to the
 *  /categories layout and stay on screen, so a click on another category
 *  swaps only this pane — and the hover prefetch has a boundary to stop at. */
export default function CategoryLoading() {
  return (
    <div className="min-w-0 animate-pulse" aria-busy="true">
      <div className="h-[108px] rounded-xl border border-line bg-surface" />
      <div className="mt-5 mb-3 h-3.5 w-52 rounded bg-raised" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-3 rounded-xl border border-line bg-surface p-5">
            <div className="flex gap-3">
              <div className="h-12 w-12 rounded-xl bg-raised" />
              <div className="flex-1 space-y-2"><div className="h-4 w-3/4 rounded bg-raised" /><div className="h-3 w-1/2 rounded bg-raised" /></div>
            </div>
            <div className="h-3 w-2/3 rounded bg-raised" />
            <div className="h-7 w-28 rounded bg-raised" />
          </div>
        ))}
      </div>
    </div>
  );
}
