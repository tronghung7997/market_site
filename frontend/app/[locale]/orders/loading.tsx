import { BuyerOrdersSkeleton } from "@/features/buyer-orders";

export default function OrdersLoading() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6">
      <BuyerOrdersSkeleton />
    </div>
  );
}
