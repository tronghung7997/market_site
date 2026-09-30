import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  addTag, applySlashInsert, blockReasonValid, canTransition, dedupeTickets, formatDuration, formatVnDateTime, isSendShortcut,
  listQuery, matchCanned, mergeTimeline, parseSupportUrl, renderPlaceholders, slashQuery, splitSupportPath, supportUrlSearch,
  ticketInView, unfilledPlaceholders, validateCanned, visibleNotes, DEFAULT_FILTERS,
} from "../features/admin-support/model.ts";

const msg = (id: number, at: string) => ({ id, created_at: at, body: `m${id}`, sender_id: 1, sender_role: "buyer", client_message_id: "" }) as never;
const note = (id: number, at: string) => ({ id, created_at: at, body: `n${id}`, author_email: "a@x" }) as never;

describe("admin support model", () => {
  it("parses and writes URL filters, dropping defaults and junk", () => {
    const s = parseSupportUrl(new URLSearchParams("view=mine&role=seller&kind=nope&assignee=12&tag=%20Proxy%20&q=ORD-1"));
    assert.deepEqual(s, { view: "mine", q: "ORD-1", role: "seller", kind: "", assignee: "12", tag: "proxy" });
    assert.equal(parseSupportUrl(new URLSearchParams("view=bogus&assignee=x")).view, "waiting");
    assert.equal(parseSupportUrl(new URLSearchParams("assignee=x")).assignee, "");
    assert.equal(supportUrlSearch(DEFAULT_FILTERS, new URLSearchParams("keep=1&view=open")), "keep=1");
    assert.equal(supportUrlSearch({ ...DEFAULT_FILTERS, view: "all", q: " a " }), "view=all&q=a");
  });

  it("splits the locale path and conversation id", () => {
    assert.deepEqual(splitSupportPath("/vi/admin/support/abc-1"), { base: "/vi/admin/support", id: "abc-1" });
    assert.deepEqual(splitSupportPath("/en/admin/support"), { base: "/en/admin/support", id: null });
  });

  it("builds the list query", () => {
    assert.deepEqual(listQuery({ ...DEFAULT_FILTERS, assignee: "7", tag: "x" }), { view: "waiting", limit: 30, assignee: 7, tag: "x" });
    assert.equal(listQuery({ ...DEFAULT_FILTERS, assignee: "none" }).assignee, "none");
  });

  it("decides which tickets stay in a view", () => {
    const open = { status: "open", assignee: { id: 5, email: "" }, waiting_since: "2026-09-30T00:00:00Z" };
    assert.equal(ticketInView(open, "waiting", 5), true);
    assert.equal(ticketInView({ ...open, waiting_since: null }, "waiting", 5), false);
    assert.equal(ticketInView(open, "mine", 5), true);
    assert.equal(ticketInView(open, "mine", 6), false);
    assert.equal(ticketInView({ ...open, status: "resolved" }, "open", 5), false);
    assert.equal(ticketInView({ ...open, status: "closed" }, "resolved", 5), true);
    assert.equal(ticketInView({ ...open, status: "blocked" }, "all", 5), true);
  });

  it("mirrors the backend transitions", () => {
    assert.equal(canTransition("open", "blocked"), true);
    assert.equal(canTransition("resolved", "blocked"), false);
    assert.equal(canTransition("blocked", "open"), true);
    assert.equal(canTransition("closed", "resolved"), false);
  });

  it("renders placeholders and keeps unknown ones visible", () => {
    const body = "Chào {ten}, đơn {ma_don} của shop {shop}. {other}";
    assert.equal(renderPlaceholders(body, { ten: "minh", ma_don: "ORD-8K2Q4F", shop: "Proxy Nhanh" }), "Chào minh, đơn ORD-8K2Q4F của shop Proxy Nhanh. {other}");
    const partial = renderPlaceholders(body, { ten: "minh", ma_don: null, shop: "  " });
    assert.equal(partial, "Chào minh, đơn {ma_don} của shop {shop}. {other}");
    assert.deepEqual(unfilledPlaceholders(partial), ["ma_don", "shop"]);
  });

  it("finds the slash query under the caret and inserts", () => {
    assert.deepEqual(slashQuery("/ch", 3), { start: 0, query: "ch" });
    assert.deepEqual(slashQuery("hi /Pro", 7), { start: 3, query: "pro" });
    assert.equal(slashQuery("a/b", 3), null);
    assert.equal(slashQuery("http://x", 8), null);
    assert.deepEqual(applySlashInsert("hi /pro tail", 3, 7, "XYZ"), { text: "hi XYZ tail", caret: 6 });
  });

  it("ranks canned replies by shortcut prefix, then substring", () => {
    const r = [{ shortcut: "rut", title: "Rút tiền" }, { shortcut: "proxyloi", title: "Proxy lỗi" }, { shortcut: "chao", title: "Chào hỏi proxy" }];
    assert.deepEqual(matchCanned(r, "pro").map((x) => x.shortcut), ["proxyloi", "chao"]);
    assert.deepEqual(matchCanned(r, "").map((x) => x.shortcut), ["chao", "proxyloi", "rut"]);
  });

  it("validates canned replies", () => {
    assert.deepEqual(validateCanned({ shortcut: "chao", title: "Chào", body: "Hi" }), {});
    const e = validateCanned({ shortcut: "Chào hỏi", title: "", body: " " });
    assert.ok(e.shortcut && e.title && e.body);
    assert.ok(validateCanned({ shortcut: "chao", title: "t", body: "b" }, [{ id: 1, shortcut: "chao" }]).shortcut);
    assert.deepEqual(validateCanned({ shortcut: "chao", title: "t", body: "b" }, [{ id: 1, shortcut: "chao" }], 1), {});
  });

  it("merges messages and notes chronologically", () => {
    const items = mergeTimeline(
      [msg(2, "2026-09-30T02:00:00Z"), msg(1, "2026-09-30T01:00:00Z")],
      [note(9, "2026-09-30T01:30:00Z"), note(8, "2026-09-30T02:00:00Z")],
    );
    assert.deepEqual(items.map((i) => i.key), ["m1", "n9", "m2", "n8"]);
    assert.equal(items[1].type, "note");
  });

  it("hides notes older than unloaded history", () => {
    const notes = [note(1, "2026-09-30T00:00:00Z"), note(2, "2026-09-30T03:00:00Z")];
    const messages = [msg(5, "2026-09-30T02:00:00Z")];
    assert.deepEqual(visibleNotes(notes, messages, true).map((n: { id: number }) => n.id), [2]);
    assert.equal(visibleNotes(notes, messages, false).length, 2);
  });

  it("handles tags, block reasons, durations, keys and dedupe", () => {
    assert.deepEqual(addTag(["a"], "  Proxy   Lỗi "), ["a", "proxy lỗi"]);
    assert.deepEqual(addTag(["a"], "A"), ["a"]);
    assert.equal(addTag(Array.from({ length: 10 }, (_, i) => `t${i}`), "x").length, 10);
    assert.equal(blockReasonValid("ab"), false);
    assert.equal(blockReasonValid("Spam"), true);
    assert.equal(formatDuration(42), "42 phút");
    assert.equal(formatDuration(150), "2 giờ");
    assert.equal(formatVnDateTime("2026-09-30T02:20:00Z"), "30/09 09:20");
    assert.equal(isSendShortcut({ key: "Enter", metaKey: true, ctrlKey: false }), true);
    assert.equal(isSendShortcut({ key: "Enter", metaKey: false, ctrlKey: false }), false);
    assert.deepEqual(dedupeTickets([{ items: [{ id: "a" }, { id: "b" }] }, { items: [{ id: "b" }, { id: "c" }] }]).map((t) => t.id), ["a", "b", "c"]);
  });
});
