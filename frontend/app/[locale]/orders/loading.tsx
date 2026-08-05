import { Card } from "@/components/ui";

function Bone({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-raised ${className ?? ""}`} />;
}

export default function OrdersLoading() {
  return (
    <div className="w-full mx-auto max-w-[1200px] px-6 py-10">
      <div className="grid lg:grid-cols-[280px_1fr] gap-6">
        <aside className="space-y-4">
          <Bone className="h-7 w-32" />
          <Card className="p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i}>
                  <Bone className="h-3 w-12 mb-1.5" />
                  <Bone className="h-5 w-16" />
                </div>
              ))}
            </div>
          </Card>
          <Card className="p-4 space-y-3">
            <div className="flex gap-1">
              {Array.from({ length: 4 }).map((_, i) => (
                <Bone key={i} className="h-7 w-16 rounded-md" />
              ))}
            </div>
            <Bone className="h-9 w-full" />
            <div className="grid grid-cols-2 gap-2">
              <Bone className="h-9" />
              <Bone className="h-9" />
            </div>
            <Bone className="h-9 w-full" />
          </Card>
        </aside>
        <div className="space-y-3">
          <Bone className="h-4 w-20 mb-2" />
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="p-4">
              <div className="flex gap-3">
                <Bone className="h-10 w-10 rounded-lg shrink-0" />
                <div className="flex-1 space-y-2">
                  <Bone className="h-4 w-48" />
                  <Bone className="h-3 w-32" />
                  <Bone className="h-3 w-56" />
                </div>
                <Bone className="h-5 w-20 shrink-0" />
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
