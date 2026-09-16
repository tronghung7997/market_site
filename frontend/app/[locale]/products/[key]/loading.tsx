import { Card } from "@/components/ui";

function Bone({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-raised ${className ?? ""}`} />;
}

export default function ProductLoading() {
  return (
    <div className="w-full mx-auto max-w-[1200px] px-6 py-6">
      <Bone className="h-4 w-48 mb-6" />
      <div className="grid lg:grid-cols-[1fr_340px] gap-8">
        <div className="space-y-6">
          <Card className="p-6">
            <div className="flex gap-4">
              <Bone className="h-12 w-12 rounded-lg shrink-0" />
              <div className="space-y-2 flex-1">
                <Bone className="h-6 w-64" />
                <div className="flex gap-2">
                  <Bone className="h-5 w-16 rounded-full" />
                  <Bone className="h-5 w-20 rounded-full" />
                </div>
              </div>
            </div>
            <Bone className="h-8 w-28 mt-4" />
            <Bone className="h-4 w-full mt-4" />
          </Card>
          <Card className="p-6 space-y-3">
            <Bone className="h-4 w-16" />
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex justify-between py-2 border-b border-line">
                <Bone className="h-4 w-20" />
                <Bone className="h-4 w-32" />
              </div>
            ))}
          </Card>
        </div>
        <Card className="p-5 h-fit space-y-4">
          <Bone className="h-5 w-20" />
          <Bone className="h-4 w-full" />
          <Bone className="h-10 w-full" />
          <Bone className="h-12 w-full rounded-lg" />
        </Card>
      </div>
    </div>
  );
}
