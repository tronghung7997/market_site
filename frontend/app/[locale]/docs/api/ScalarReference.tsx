"use client";

import dynamic from "next/dynamic";

/* Scalar ships a Vue runtime and touches `window`; load it only in the browser. */
const ScalarInner = dynamic(() => import("./ScalarInner"), {
  ssr: false,
  loading: () => <div className="h-64 animate-pulse rounded-card border border-line bg-raised" aria-busy="true" />,
});

export default function ScalarReference({ spec }: { spec: Record<string, unknown> }) {
  return <ScalarInner spec={spec} />;
}
