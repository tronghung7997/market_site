"use client";

import { use } from "react";
import { DisputeCase } from "@/features/admin-disputes";

export default function AdminDisputeCasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <DisputeCase id={Number(id)} />;
}
