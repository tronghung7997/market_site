"use client";

import { SupportConsole } from "@/features/admin-support";

/** Same console; it reads the conversation id from the URL so History API
 *  navigation between tickets never remounts the page. */
export default function AdminSupportConversationPage() {
  return <SupportConsole />;
}
