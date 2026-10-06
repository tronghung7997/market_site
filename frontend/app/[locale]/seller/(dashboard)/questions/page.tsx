import { Suspense } from "react";
import { SellerQuestionsConsole } from "@/features/seller-questions";

export default function SellerQuestionsPage() {
  // The console reads its filter and page from the URL (useSearchParams).
  return (
    <Suspense>
      <SellerQuestionsConsole />
    </Suspense>
  );
}
