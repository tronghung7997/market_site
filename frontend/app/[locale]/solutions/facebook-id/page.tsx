import { Suspense } from "react";
import { FacebookLookupPage } from "@/features/facebook-lookup";

export default function FacebookIdPage() {
  // useSearchParams (deep-link `?q=`) needs a Suspense boundary for static rendering.
  return <Suspense fallback={null}><FacebookLookupPage /></Suspense>;
}
