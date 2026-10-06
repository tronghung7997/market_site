import { OfferGridSkeleton } from "@/features/catalog/client";

/** Product-pane skeleton (toolbar + offer grid). The header and rail belong to
 *  the /categories layout and stay on screen, so a click on another category
 *  swaps only this pane — and the hover prefetch has a boundary to stop at. */
export default function CategoryLoading() {
  return (
    <div aria-busy="true">
      <OfferGridSkeleton toolbar />
    </div>
  );
}
