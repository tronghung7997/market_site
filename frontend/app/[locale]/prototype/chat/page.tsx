// PROTOTYPE — throwaway. Question: which chat workspace and UI flow should
// graduate into the real buyer/seller/admin experience?
// Run: cd frontend && npm run dev; open /en/prototype/chat?variant=A

import { notFound } from "next/navigation";
import ChatPrototype, { type PrototypeFlow, type PrototypeRole, type PrototypeVariant } from "./ChatPrototype";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ChatPrototypePage({ searchParams }: { searchParams: SearchParams }) {
  if (process.env.NODE_ENV === "production") notFound();

  const query = await searchParams;
  const requestedVariant = first(query.variant)?.toUpperCase();
  const requestedRole = first(query.role)?.toLowerCase();
  const requestedFlow = first(query.flow)?.toLowerCase();

  const initialVariant: PrototypeVariant = requestedVariant === "B" || requestedVariant === "C" ? requestedVariant : "A";
  const initialRole: PrototypeRole = requestedRole === "seller" || requestedRole === "admin" ? requestedRole : "buyer";
  const initialFlow: PrototypeFlow = requestedFlow === "support" || requestedFlow === "dispute" ? requestedFlow : "order";

  return <ChatPrototype initialVariant={initialVariant} initialRole={initialRole} initialFlow={initialFlow} />;
}

