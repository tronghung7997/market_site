import assert from "node:assert/strict";
import test from "node:test";

import { adminSupportInboxPath, conversationInboxPath, orderWorkspaceHref, unreadTotal } from "../lib/chat-inbox.ts";

test("every conversation opens in the unified inbox", () => {
  assert.equal(conversationInboxPath("room-1"), "/messages/room-1");
});

test("order links follow the conversation context role, not a second inbox", () => {
  assert.equal(orderWorkspaceHref("buyer", 12), "/seller/orders?search=%2312");
  assert.equal(orderWorkspaceHref("seller", 12), "/orders?search=%2312");
  assert.equal(orderWorkspaceHref("buyer"), "/seller/orders");
  assert.equal(orderWorkspaceHref("admin", 12), "/orders?search=%2312");
  assert.equal(orderWorkspaceHref("buyer", 12, { admin: true }), "/admin/orders?highlight=12");
  assert.equal(adminSupportInboxPath("room-1"), "/admin/support/room-1");
});

test("unread total sums conversation badges", () => {
  assert.equal(unreadTotal([{ unread_count: 1 }, { unread_count: 4 }]), 5);
  assert.equal(unreadTotal(undefined), 0);
});
