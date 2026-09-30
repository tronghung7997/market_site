import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  composeRejectMessage, diffAnswer, formatWait, isTypingTarget, neighbourAfterRemoval, parseQueueUrl, queueUrlSearch,
  rejectMessageValid, REJECT_MAX, resubmitDate, shortcutAction, stepId, submissionNumber, waitHours,
} from "../features/admin-seller-applications/model.ts";

describe("admin seller applications model", () => {
  it("composes the reject message from templates and free text", () => {
    assert.equal(composeRejectMessage(["Danh mục bị cấm", "Thông tin liên hệ sai"], "  Sửa lại SĐT "), "- Danh mục bị cấm\n- Thông tin liên hệ sai\nSửa lại SĐT");
    assert.equal(composeRejectMessage([], ""), "");
  });

  it("requires 3..500 characters", () => {
    assert.equal(rejectMessageValid("ab"), false);
    assert.equal(rejectMessageValid("abc"), true);
    assert.equal(rejectMessageValid("x".repeat(REJECT_MAX + 1)), false);
  });

  it("computes the resubmit date only for positive days", () => {
    const now = new Date("2026-09-30T00:00:00Z");
    assert.equal(resubmitDate(0, now), null);
    assert.equal(resubmitDate(7, now)?.toISOString(), "2026-10-07T00:00:00.000Z");
  });

  it("round-trips URL state and drops defaults", () => {
    const state = parseQueueUrl(new URLSearchParams("status=rejected&app=12&q=shop&x=1"));
    assert.deepEqual(state, { status: "rejected", app: 12, q: "shop" });
    assert.equal(queueUrlSearch({ status: "pending", app: null, q: "" }, new URLSearchParams("status=rejected&x=1")), "x=1");
    assert.deepEqual(parseQueueUrl(new URLSearchParams("status=bogus&app=-3")), { status: "pending", app: null, q: "" });
  });

  it("moves through the queue and advances after a decision", () => {
    assert.equal(stepId([4, 5, 6], null, 1), 4);
    assert.equal(stepId([4, 5, 6], 5, 1), 6);
    assert.equal(stepId([4, 5, 6], 6, 1), 6);
    assert.equal(stepId([4, 5, 6], 4, -1), 4);
    assert.equal(stepId([], 1, 1), null);
    assert.equal(neighbourAfterRemoval([4, 5, 6], 5), 6);
    assert.equal(neighbourAfterRemoval([4, 5, 6], 6), 5);
    assert.equal(neighbourAfterRemoval([4], 4), null);
  });

  it("formats waiting time", () => {
    const now = Date.parse("2026-09-30T12:00:00Z");
    assert.equal(Math.round(waitHours("2026-09-28T12:00:00Z", now)), 48);
    assert.equal(formatWait(0.2), "12 phút");
    assert.equal(formatWait(5.5), "5 giờ");
    assert.equal(formatWait(72), "3 ngày");
    assert.equal(submissionNumber(2, 1), 3);
  });

  it("diffs answers against the previous snapshot", () => {
    assert.deepEqual(diffAnswer("contact", "tg @new", { contact: "tg @old" }), { current: "tg @new", previous: "tg @old" });
    assert.deepEqual(diffAnswer("contact", "same", { contact: "same" }), { current: "same", previous: null });
    assert.deepEqual(diffAnswer("contact", "x", null), { current: "x", previous: null });
    const names = (id: number) => ({ 1: "Game", 2: "AI" } as Record<number, string>)[id] ?? `#${id}`;
    assert.deepEqual(diffAnswer("category_ids", [1, 2], { category_ids: [1] }, names), { current: "Game, AI", previous: "Game" });
  });

  it("maps shortcuts and ignores typing targets", () => {
    assert.equal(shortcutAction("J"), "next");
    assert.equal(shortcutAction("r"), "reject");
    assert.equal(shortcutAction("x"), null);
    assert.equal(isTypingTarget({ tagName: "textarea" }), true);
    assert.equal(isTypingTarget({ tagName: "DIV", isContentEditable: true }), true);
    assert.equal(isTypingTarget({ tagName: "BUTTON" }), false);
  });
});
