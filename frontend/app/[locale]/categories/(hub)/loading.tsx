/** Hub product-pane skeleton (branch shelves as rows). The header, search
 *  field and rail belong to the /categories layout and stay on screen. */
export default function CategoriesLoading() {
  return (
    <div className="min-w-0 animate-pulse space-y-10" aria-busy="true">
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
  );
}
