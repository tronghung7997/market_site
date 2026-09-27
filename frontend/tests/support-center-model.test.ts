import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  countByTopic,
  filterFaq,
  foldText,
  isSupportTopic,
  SUPPORT_FAQ,
  SUPPORT_TOPICS,
  type FaqEntry,
} from "../features/support-center/model.ts";

const entries: FaqEntry[] = [
  { id: "topUp", topic: "payments", q: "Nạp tiền bằng cách nào?", a: "Chuyển khoản VietQR hoặc USDT." },
  { id: "refund", topic: "payments", q: "Tiền hoàn về đâu?", a: "Về ví GMMO của bạn." },
  { id: "whenDispute", topic: "disputes", q: "Khi nào mở khiếu nại?", a: "Khi đơn đã giao và còn thời gian bảo vệ." },
];

describe("support center FAQ filter", () => {
  it("folds Vietnamese accents and đ", () => {
    assert.equal(foldText("  Hoàn   TIỀN đơn "), "hoan tien don");
  });

  it("matches every word, without accents, in question or answer", () => {
    assert.deepEqual(filterFaq(entries, { topic: null, query: "hoan ve vi" }).map((e) => e.id), ["refund"]);
    assert.deepEqual(filterFaq(entries, { topic: null, query: "vietqr" }).map((e) => e.id), ["topUp"]);
    assert.deepEqual(filterFaq(entries, { topic: null, query: "khieu nai usdt" }), []);
  });

  it("limits to a topic and returns everything for an empty query", () => {
    assert.equal(filterFaq(entries, { topic: "payments", query: "" }).length, 2);
    assert.equal(filterFaq(entries, { topic: "disputes", query: "tien" }).length, 0);
    assert.equal(filterFaq(entries, { topic: null, query: "   " }).length, 3);
  });

  it("counts matches per topic for the chips", () => {
    const counts = countByTopic(entries, "tien");
    assert.equal(counts.payments, 2);
    assert.equal(counts.disputes, 0);
    assert.equal(counts.safety, 0);
  });

  it("knows its topics and gives every topic at least one question", () => {
    assert.ok(isSupportTopic("orders"));
    assert.ok(!isSupportTopic("billing"));
    assert.ok(!isSupportTopic(null));
    for (const topic of SUPPORT_TOPICS) assert.ok(SUPPORT_FAQ[topic].length > 0, topic);
    const ids = SUPPORT_TOPICS.flatMap((t) => SUPPORT_FAQ[t]);
    assert.equal(new Set(ids).size, ids.length, "question ids are unique");
  });
});
