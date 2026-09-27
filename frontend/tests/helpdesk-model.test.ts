import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  awaitingDesk, filterDeskRooms, helpdeskRoom, initialHelpdeskRole, launcherHidden, launcherRaised, quickTopics, sellerWorkspace,
} from "../features/helpdesk/model.ts";

const room = (id: string, kind: string, senderRole: string | null) => ({
  id,
  kind,
  last_message: senderRole ? { sender_role: senderRole } : null,
}) as never;

describe("helpdesk launcher", () => {
  it("stays out of the inbox and the sign-in pages", () => {
    assert.equal(launcherHidden("/messages"), true);
    assert.equal(launcherHidden("/messages/abc"), true);
    assert.equal(launcherHidden("/login"), true);
    assert.equal(launcherHidden("/"), false);
    assert.equal(launcherHidden("/messagesx"), false);
    assert.equal(launcherHidden("/products/gmail-abc"), false);
    assert.equal(launcherRaised("/products/gmail-abc"), true);
    assert.equal(launcherRaised("/wallet"), false);
  });

  it("finds the helpdesk thread for each role among the account's chats", () => {
    type Desk = { id: string; kind: "helpdesk"; viewer_role: "buyer" | "seller" | null; unread_count: number };
    const desk = (id: string, viewer: Desk["viewer_role"]): Desk => ({ id, kind: "helpdesk", viewer_role: viewer, unread_count: 0 });
    assert.equal(helpdeskRoom(undefined), null);
    assert.equal(helpdeskRoom([room("a", "order", "buyer")]), null);
    assert.equal(helpdeskRoom<Desk>([room("a", "order", "buyer"), desk("b", "buyer")])?.id, "b");
    const both = [desk("shop", "seller"), desk("mine", "buyer")];
    assert.equal(helpdeskRoom(both, "buyer")?.id, "mine");
    assert.equal(helpdeskRoom(both, "seller")?.id, "shop");
    assert.equal(helpdeskRoom([desk("shop", "seller")], "buyer"), null);
    // An older payload without viewer_role reads as the buyer thread.
    assert.equal(helpdeskRoom([desk("old", null)], "buyer")?.id, "old");
  });

  it("opens the thread with a new reply, else follows the workbench", () => {
    const none = { buyer: 0, seller: 0 };
    assert.equal(sellerWorkspace("/seller"), true);
    assert.equal(sellerWorkspace("/seller/orders"), true);
    assert.equal(sellerWorkspace("/sellers/shop-abc"), false);
    assert.equal(sellerWorkspace("/sell"), false);
    assert.equal(initialHelpdeskRole("/seller/orders", false, none), "buyer");
    assert.equal(initialHelpdeskRole("/seller/orders", true, none), "seller");
    assert.equal(initialHelpdeskRole("/wallet", true, none), "buyer");
    assert.equal(initialHelpdeskRole("/wallet", true, { buyer: 0, seller: 2 }), "seller");
    assert.equal(initialHelpdeskRole("/seller", true, { buyer: 1, seller: 0 }), "buyer");
    assert.equal(initialHelpdeskRole("/seller", true, { buyer: 1, seller: 1 }), "seller");
  });

  it("offers topics that fit the thread", () => {
    assert.deepEqual([...quickTopics("buyer", false)], ["deposit", "order", "account", "selling"]);
    assert.deepEqual([...quickTopics("buyer", true)], ["deposit", "order", "account"]);
    assert.deepEqual([...quickTopics("seller", true)], ["listing", "payout", "shopOrder", "tier"]);
  });

  it("filters the admin desk by kind and by who spoke last", () => {
    const rooms = [room("a", "helpdesk", "buyer"), room("b", "helpdesk", "admin"), room("c", "support", "seller"), room("d", "support", null)];
    assert.equal(awaitingDesk(rooms[0]), true);
    assert.equal(awaitingDesk(rooms[1]), false);
    assert.equal(awaitingDesk(rooms[3]), false);
    assert.deepEqual(filterDeskRooms(rooms, "waiting").map((r: { id: string }) => r.id), ["a", "c"]);
    assert.deepEqual(filterDeskRooms(rooms, "helpdesk").map((r: { id: string }) => r.id), ["a", "b"]);
    assert.deepEqual(filterDeskRooms(rooms, "support").map((r: { id: string }) => r.id), ["c", "d"]);
    assert.equal(filterDeskRooms(rooms, "all").length, 4);
  });
});
