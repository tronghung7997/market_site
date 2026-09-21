function Bone({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-raised ${className ?? ""}`} />;
}

/**
 * Storefront-wide instant loading state. Reserves the viewport so the footer
 * does not jump while a dynamic page streams in, and gives Link prefetches a
 * cheap boundary to stop at instead of rendering the whole page.
 */
export default function StorefrontLoading() {
  return (
    <div className="w-full mx-auto max-w-[1200px] px-6 py-8 min-h-[70vh]" aria-busy="true">
      <Bone className="h-4 w-40 mb-6" />
      <Bone className="h-9 w-2/3 max-w-xl mb-3" />
      <Bone className="h-4 w-1/2 max-w-md mb-10" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-line p-4 space-y-3">
            <Bone className="h-10 w-10 rounded-lg" />
            <Bone className="h-4 w-3/4" />
            <Bone className="h-3 w-1/2" />
            <Bone className="h-8 w-24 mt-2" />
          </div>
        ))}
      </div>
    </div>
  );
}
