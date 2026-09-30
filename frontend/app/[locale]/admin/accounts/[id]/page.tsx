"use client";

import { use } from "react";
import { AccountProfilePage } from "@/features/admin-accounts";

export default function AdminAccountProfileRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <AccountProfilePage id={Number(id)} />;
}
