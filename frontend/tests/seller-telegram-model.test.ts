import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  formatCountdown, linkedChatCount, looksLikeBotToken, needsFirstChat, secondsLeft, TELEGRAM_EVENTS,
} from "../features/seller-telegram/model.ts";
import { notificationMessage } from "../features/notifications/model.ts";

const chat = (status: "pending" | "active" | "broken") => ({ key: status, type: "private", title: "A", status });

describe("seller telegram", () => {
  it("accepts a BotFather token and rejects obvious mistakes", () => {
    assert.equal(looksLikeBotToken(" 7412345678:AAHfakeTokenForTestsOnly_abcdefghijklmnQx9 "), true);
    assert.equal(looksLikeBotToken("7412345678AAHfakeTokenForTestsOnly_abcdefghijklmnQx9"), false);
    assert.equal(looksLikeBotToken("7412345678:short"), false);
    assert.equal(looksLikeBotToken("@shopabc_notify_bot"), false);
  });

  it("counts the link code down", () => {
    const now = Date.parse("2026-09-28T10:00:00Z");
    assert.equal(secondsLeft("2026-09-28T10:09:42Z", now), 582);
    assert.equal(secondsLeft("2026-09-28T09:59:00Z", now), 0);
    assert.equal(secondsLeft(null, now), 0);
    assert.equal(formatCountdown(582), "9:42");
    assert.equal(formatCountdown(5), "0:05");
  });

  it("opens on linking while no chat can receive, and counts only reachable chats", () => {
    assert.equal(needsFirstChat({ connected: true, chats: [] }), true);
    assert.equal(needsFirstChat({ connected: true, chats: [chat("broken")] }), true);
    assert.equal(needsFirstChat({ connected: true, chats: [chat("pending")] }), false);
    assert.equal(needsFirstChat({ connected: false, chats: [] }), false);
    assert.equal(linkedChatCount({ chats: [chat("active"), chat("pending"), chat("broken")] }), 2);
  });

  it("lists every backend event switch once", () => {
    assert.deepEqual([...TELEGRAM_EVENTS].sort(), [
      "chat_messages", "dispute", "order_pending", "order_sla", "stock_low", "supply_error", "withdrawal",
    ]);
  });

  it("renders the paused bell notification with its reason", () => {
    const message = notificationMessage(
      { kind: "telegram_paused", params: { reason: "token_rejected" }, href: "/seller/telegram" }, String,
    );
    assert.equal(message.key, "telegram_paused");
    assert.equal(message.values.reason, "token_rejected");
  });
});
