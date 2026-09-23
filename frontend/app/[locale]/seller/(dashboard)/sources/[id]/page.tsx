"use client";

import { use } from "react";
import { SourceWorkspace } from "@/features/seller-sources";

export default function SellerSourcePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <SourceWorkspace area="seller" sourceRef={id} />;
}
