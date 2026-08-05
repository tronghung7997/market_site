import { Card } from "@/components/ui";

function Bone({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-raised ${className ?? ""}`} />;
}

export default function AffiliateLoading() {
  return (
    <div className="w-full mx-auto max-w-[1000px] px-6 py-10">
      <Bone className="h-8 w-32 mb-6" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="p-5">
            <Bone className="h-3 w-16 mb-2" />
            <Bone className="h-7 w-20" />
          </Card>
        ))}
      </div>
      <Card className="p-5 mb-6">
        <Bone className="h-4 w-24 mb-3" />
        <Bone className="h-56 w-full" />
      </Card>
      <Card className="p-5">
        <Bone className="h-4 w-32 mb-3" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Bone key={i} className="h-10 w-full mb-2" />
        ))}
      </Card>
    </div>
  );
}
