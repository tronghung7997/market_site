/** Placeholder grid shaped like `OfferCard` (cover, two title lines, the lead
 *  number, price, tags, shop row) so the real cards land without a jump. */
export function OfferGridSkeleton({ count = 6, toolbar = false }: { count?: number; toolbar?: boolean }) {
  return (
    <div className="min-w-0 animate-pulse motion-reduce:animate-none" aria-hidden="true">
      {toolbar && (
        <>
          <div className="h-[108px] rounded-card border border-line bg-surface" />
          <div className="mt-4 mb-3 h-3.5 w-52 rounded bg-raised" />
        </>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="flex flex-col rounded-card border border-line bg-surface">
            <div className="p-4 sm:p-5">
              <div className="flex gap-3">
                <div className="h-11 w-11 shrink-0 rounded-xl bg-raised" />
                <div className="flex-1 space-y-2 pt-0.5">
                  <div className="h-4 w-11/12 rounded bg-raised" />
                  <div className="h-4 w-2/3 rounded bg-raised" />
                </div>
              </div>
              <div className="mt-6 flex items-end justify-between">
                <div className="space-y-2"><div className="h-7 w-20 rounded bg-raised" /><div className="h-3 w-16 rounded bg-raised" /></div>
                <div className="space-y-2"><div className="ml-auto h-3 w-8 rounded bg-raised" /><div className="h-5 w-20 rounded bg-raised" /></div>
              </div>
              <div className="mt-4 flex gap-2"><div className="h-5 w-20 rounded-md bg-raised" /><div className="h-5 w-16 rounded-md bg-raised" /></div>
            </div>
            <div className="flex items-center gap-2.5 border-t border-line px-4 py-3 sm:px-5">
              <div className="h-8 w-8 rounded-full bg-raised" />
              <div className="space-y-1.5"><div className="h-3 w-28 rounded bg-raised" /><div className="h-2.5 w-20 rounded bg-raised" /></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
