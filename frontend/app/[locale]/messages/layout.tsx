import type { ReactNode } from "react";
import { PRIVATE_ROBOTS } from "@/lib/seo";

export const metadata = PRIVATE_ROBOTS;

export default function MessagesLayout({ children }: { children: ReactNode }) {
  return children;
}
