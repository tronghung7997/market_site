import { Card } from "@/components/ui";

function Bone({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-raised ${className ?? ""}`} />;
}

export default function WalletLoading() {
  return (
    <div className="w-full mx-auto max-w-[1200px] px-6 py-10">
      <div className="grid lg:grid-cols-[380px_1fr] gap-6">
        <div className="space-y-5">
          <Card className="p-6">
            <Bone className="h-3 w-24 mb-4" />
            <Bone className="h-10 w-48" />
          </Card>
          <Card className="p-5 space-y-3">
            <Bone className="h-4 w-16" />
            <div className="grid grid-cols-2 gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Bone key={i} className="h-9" />
              ))}
            </div>
            <Bone className="h-9 w-full" />
          </Card>
        </div>
        <div>
          <Bone className="h-4 w-28 mb-3" />
          <Card>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-3 border-b border-line last:border-0">
                <div className="space-y-1.5">
                  <Bone className="h-4 w-48" />
                  <Bone className="h-5 w-20 rounded-full" />
                </div>
                <Bone className="h-4 w-20" />
              </div>
            ))}
          </Card>
        </div>
      </div>
    </div>
  );
}
