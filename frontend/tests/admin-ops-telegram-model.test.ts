import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { botState, isDirty, problems, toForm, toUpdate } from "../features/admin-ops-telegram/model.ts";
import type { OpsTelegramConfig } from "../lib/types.ts";

const cfg = (over: Partial<OpsTelegramConfig> = {}): OpsTelegramConfig => ({
  enabled: false, token_set: false, token_hint: null, bot_username: null,
  ops_chat_id: "", channel_chat_id: "", channel_enabled: false, channel_interval_minutes: 30,
  events: {
    withdrawal_requested: true, dispute_opened: true, dispute_timeout: true, deposit_unmatched: true,
    deposit_anomaly: true, site_switch: true, system_alert: true, seller_application: true,
  },
  quiet_low_priority: false, status: "active", paused_reason: null, paused_at: null,
  updated_at: null, updated_by_id: null, outbox: { pending: 0, failed_24h: 0, last_sent_at: null },
  ...over,
});

const TOKEN = "7412345678:AAHfakeOpsTokenForTestsOnly_abcdefghijklmWq7";

describe("ops bot form", () => {
  it("sends only what changed and the token only when typed", () => {
    const base = cfg({ token_set: true, token_hint: "…mWq7", ops_chat_id: "-1001234567890" });
    const form = { ...toForm(base), enabled: true, events: { ...base.events, system_alert: false } };
    assert.deepEqual(toUpdate(form, base), { enabled: true, events: { system_alert: false } });
    assert.ok(isDirty(form, base));
    assert.deepEqual(toUpdate({ ...form, token: ` ${TOKEN} ` }, base).bot_token, TOKEN);
    assert.equal(toUpdate({ ...form, clearToken: true }, base).bot_token, "");
    assert.equal(isDirty(toForm(base), base), false);
  });

  it("flags bad input and an incomplete bot before saving", () => {
    const base = cfg();
    assert.deepEqual(problems({ ...toForm(base), token: "123:abc" }, base), ["token"]);
    assert.deepEqual(problems({ ...toForm(base), opsChat: "group name" }, base), ["opsChat"]);
    assert.deepEqual(problems({ ...toForm(base), interval: "2" }, base), ["interval"]);
    assert.deepEqual(problems({ ...toForm(base), enabled: true }, base), ["incomplete"]);
    assert.deepEqual(problems({ ...toForm(base), enabled: true, token: TOKEN, channelChat: "@gmmo_news" }, base), []);
  });

  it("names the bot state", () => {
    assert.equal(botState(cfg()), "noToken");
    assert.equal(botState(cfg({ token_set: true })), "off");
    assert.equal(botState(cfg({ token_set: true, enabled: true })), "running");
    assert.equal(botState(cfg({ token_set: true, enabled: true, status: "paused" })), "paused");
  });
});
