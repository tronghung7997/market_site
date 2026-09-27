import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { awaitingDesk, filterDeskRooms, helpdeskRoom, launcherHidden, launcherRaised } from "../features/helpdesk/model.ts";

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

  it("finds the helpdesk thread among the account's chats", () => {
    assert.equal(helpdeskRoom(undefined), null);
    assert.equal(helpdeskRoom([room("a", "order", "buyer")]), null);
    assert.equal(helpdeskRoom([room("a", "order", "buyer"), room("b", "helpdesk", "buyer")])?.id, "b");
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
