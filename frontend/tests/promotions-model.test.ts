import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePromoCode, payableTotal, promoQuoteKey } from "../features/checkout/model.ts";
import {
  attentionLabel, compactVnd, conditionChips, customerSees, describeAudit, describeCampaign, describeOffer, discountFor,
  exampleSubtotal, parsePromoListUrl, promoListQuery, promoListSearch, rowActions, usageRatio, windowHint,
} from "../features/admin-promotions/model.ts";
import {
  changedFields, draftFromPromotion, draftWarnings, emptyDraft, patchFrom, randomCode, rebaseDraft, sampleCode,
  serverFieldErrors, validateBulkCodes, validateDraft,
} from "../features/admin-promotions/form.ts";
import { endOfMonthVn, formatVn, fromVnInput, plusDaysVn, toVnInput } from "../features/admin-promotions/time.ts";
import { caretForDigits, digitsBefore } from "../lib/utils/digit-caret.ts";
import type { AdminPromotion } from "../lib/types.ts";

const money = (n: number) => `${n.toLocaleString("vi-VN")} ₫`;

test("checkout: a quote holds only for the body it priced", () => {
  const body = { variant_id: 7, quantity: 2, expected_unit_price: 1000 };
  const key = promoQuoteKey(body)!;
  assert.equal(promoQuoteKey({ ...body, promo_code: "SALE" }), key, "the code itself is not part of the key");
  const quote = { key, total_amount: 1800 };
  assert.equal(payableTotal(2000, quote, key), 1800);
  assert.equal(payableTotal(3000, quote, promoQuoteKey({ ...body, quantity: 3 })), 3000, "another quantity drops it");
  assert.equal(payableTotal(2000, null, key), 2000);
  assert.equal(promoQuoteKey(null), null);
  assert.equal(normalizePromoCode("  sale10 "), "SALE10");
});

test("admin: draft validation mirrors the API rules", () => {
  const ok = validateDraft({ ...emptyDraft(), code: " welcome ", name: "Khách mới", discount_value: "15", max_discount_amount: "50000" });
  assert.deepEqual(ok.errors, {});
  assert.equal(ok.input?.code, "WELCOME");
  assert.equal(ok.input?.max_discount_amount, 50000);
  assert.equal(ok.input?.per_buyer_limit, 1);
  assert.equal(ok.input?.usage_limit, null);

  const fixed = validateDraft({ ...emptyDraft(), code: "OFF20K", name: "x", discount_type: "fixed", discount_value: "20000", max_discount_amount: "5000" });
  assert.equal(fixed.input?.max_discount_amount, null, "a cap never goes out with a fixed discount");

  const bad = validateDraft({ ...emptyDraft(), code: "a", name: " ", discount_value: "150", starts_at: "2026-10-10T10:00", ends_at: "2026-10-01T10:00" });
  assert.equal(bad.input, null);
  assert.deepEqual(Object.keys(bad.errors).sort(), ["code", "discount_value", "ends_at", "name"]);
});

const promo: AdminPromotion = {
  id: 1, code: "SALE10", name: "Sale", note: null, discount_type: "percent", discount_value: 10, max_discount_amount: 50000,
  min_order_amount: 100000, starts_at: null, ends_at: null, usage_limit: 100, per_buyer_limit: 1, budget_amount: 2000000,
  category_ids: [3], new_buyers_only: true, is_active: true, uses: 25, discount_given: 500000, state: "running",
  created_at: null, updated_at: null, archived_at: null, code_count: 0, codes_redeemed: 0, gmv: 0,
  attention_reason: null, budget_eta_days: null, affiliate_account_id: null, affiliate_email: null,
};

test("admin: a campaign reads as plain language", () => {
  assert.equal(describeOffer(promo, money), "Giảm 10%, tối đa 50.000 ₫");
  assert.equal(describeOffer({ discount_type: "fixed", discount_value: 20000, max_discount_amount: null }, money), "Giảm 20.000 ₫");
  assert.deepEqual(conditionChips(promo, money, () => "Facebook"), ["Đơn từ 100.000 ₫", "Facebook", "Chỉ đơn đầu tiên", "1 lần/khách"]);
  const sentence = describeCampaign(promo, money, () => "Facebook");
  assert.match(sentence, /^Khách nhập SALE10 được giảm 10%, tối đa 50\.000 ₫, cho đơn từ 100\.000 ₫, trong Facebook/);
  assert.match(sentence, /Dừng khi hết 100 lượt hoặc ngân sách 2\.000\.000 ₫\./);
  assert.match(sentence, /Thời gian: không thời hạn\.$/);
});

test("admin: round-trip, filters, usage and random codes", () => {
  const again = validateDraft(draftFromPromotion(promo)).input!;
  assert.equal(again.code, promo.code);
  assert.equal(again.budget_amount, promo.budget_amount);
  assert.deepEqual(again.category_ids, promo.category_ids);
  assert.equal(usageRatio(25, 100), 0.25);
  assert.equal(usageRatio(150, 100), 1);
  assert.equal(usageRatio(5, null), null);
  const code = randomCode("vip", 6, () => 0);
  assert.equal(code, "VIPAAAAAA");
  assert.match(randomCode(), /^[A-Z2-9]{8}$/);
});

test("admin: new server-side rules are caught before saving", () => {
  const fixedOverMin = validateDraft({ ...emptyDraft(), code: "OFF", name: "x", discount_type: "fixed", discount_value: "200000", min_order_amount: "200000" });
  assert.equal(fixedOverMin.input, null);
  assert.match(fixedOverMin.errors.discount_value!, /nhỏ hơn đơn tối thiểu/);
  const fixedNoMin = validateDraft({ ...emptyDraft(), code: "OFF", name: "x", discount_type: "fixed", discount_value: "200000" });
  assert.equal(fixedNoMin.input?.discount_value, 200000, "no minimum: any amount");
  assert.equal(validateDraft({ ...emptyDraft(), code: "AB", name: "x" }).errors.code !== undefined, true);
  assert.equal(validateDraft({ ...emptyDraft(), code: "ab-c_1", name: "x" }).input?.code, "AB-C_1");
  assert.equal(validateDraft({ ...emptyDraft(), code: "OK1", name: "x", starts_at: "2026-10-01T10:00", ends_at: "2026-10-01T10:00" }).errors.ends_at, "Kết thúc phải sau bắt đầu.");
});

test("admin: a past start only warns, and only when it changed", () => {
  const now = Date.parse("2026-10-05T00:00:00Z");
  const d = { ...emptyDraft(), starts_at: "2026-10-01T00:00" };
  assert.match(draftWarnings(d, null, now).starts_at!, /chạy ngay/);
  assert.equal(draftWarnings(d, fromVnInput("2026-10-01T00:00"), now).starts_at, undefined, "saved start is not re-warned");
  assert.equal(draftWarnings(d, "2026-09-30T17:00:35.830000+00:00", now).starts_at, undefined, "saved start with seconds is not re-warned");
  assert.equal(validateDraft({ ...d, code: "PAST", name: "x" }).input !== null, true, "allowed");
});

test("admin: change count, PATCH body and rebase", () => {
  const saved = draftFromPromotion(promo);
  assert.deepEqual(changedFields(saved, saved), []);
  const edited = { ...saved, name: "Sale 2", category_ids: [3], min_order_amount: "100000" };
  assert.deepEqual(changedFields(edited, saved), ["name"]);
  const toFixed = { ...saved, discount_type: "fixed" as const, discount_value: "20000", min_order_amount: "" };
  const fields = changedFields(toFixed, saved);
  const input = validateDraft(toFixed).input!;
  const patch = patchFrom(input, fields);
  assert.equal(patch.max_discount_amount, null, "switching to fixed clears the cap");
  assert.equal(patch.discount_type, "fixed");
  assert.equal("name" in patch, false);
  // Paused from the header while the admin edits the name: keep the edit, take the pause.
  const rebased = rebaseDraft({ ...saved, name: "Mine" }, saved, { ...saved, is_active: false });
  assert.equal(rebased.name, "Mine");
  assert.equal(rebased.is_active, false);
});

test("admin: 422 field map lands on the fields", () => {
  const err = { params: { fields: { discount_value: "Phải nhỏ hơn đơn tối thiểu", weird: "x" } } };
  assert.deepEqual(serverFieldErrors(err), { discount_value: "Phải nhỏ hơn đơn tối thiểu", code: "x" });
  assert.equal(serverFieldErrors(new Error("boom")), null);
  assert.equal(serverFieldErrors(null), null);
});

test("admin: times are GMT+7 whatever the machine timezone", () => {
  assert.equal(toVnInput("2026-10-31T16:59:00Z"), "2026-10-31T23:59");
  assert.equal(fromVnInput("2026-11-01T00:00"), "2026-10-31T17:00:00.000Z");
  assert.equal(fromVnInput("bad"), null);
  assert.equal(formatVn("2026-10-31T16:59:00Z"), "31/10/2026 23:59");
  assert.equal(endOfMonthVn(Date.parse("2026-10-31T18:00:00Z")), "2026-11-30T23:59", "already November in Vietnam");
  assert.equal(endOfMonthVn(Date.parse("2026-02-10T00:00:00Z")), "2026-02-28T23:59");
  assert.equal(plusDaysVn("2026-10-01T09:00", 7), "2026-10-08T09:00");
  assert.equal(plusDaysVn("", 7, Date.parse("2026-10-01T00:00:00Z")), "2026-10-08T07:00");
});

test("admin: list URL state round-trips and drops defaults", () => {
  const f = parsePromoListUrl(new URLSearchParams("q=sale&state=attention&sort=uses&page=3&other=1"));
  assert.deepEqual(f, { q: "sale", chip: "attention", sort: "uses", page: 3 });
  assert.equal(promoListSearch({ q: "", chip: "all", sort: "updated", page: 1 }, new URLSearchParams("other=1")), "other=1");
  assert.equal(promoListSearch(f), "q=sale&state=attention&sort=uses&page=3");
  assert.deepEqual(parsePromoListUrl(new URLSearchParams("state=nope&sort=x&page=-2")), { q: "", chip: "all", sort: "updated", page: 1 });
  assert.equal(promoListQuery({ q: " ", chip: "all", sort: "updated", page: 1 }).state, undefined);
  assert.equal(promoListQuery({ q: " a ", chip: "archived", sort: "updated", page: 2 }).q, "a");
});

test("admin: row wording", () => {
  const now = Date.parse("2026-10-01T00:00:00Z");
  assert.equal(attentionLabel("budget", 1.6), "Hết ngân sách ~2 ngày");
  assert.equal(attentionLabel("expired_active", null), "Đã hết hạn nhưng vẫn bật");
  assert.equal(attentionLabel(null, 3), null);
  assert.equal(windowHint({ starts_at: "2026-11-28T00:00:00Z", ends_at: null, is_active: true }, now), "bắt đầu sau 58 ngày");
  assert.equal(windowHint({ starts_at: null, ends_at: "2026-09-12T00:00:00Z", is_active: true }, now), "đã hết hạn nhưng vẫn bật");
  assert.equal(windowHint({ starts_at: null, ends_at: "2026-10-31T00:00:00Z", is_active: true }, now), "còn 30 ngày");
  assert.equal(windowHint({ starts_at: null, ends_at: null, is_active: true }, now), null);
  assert.equal(compactVnd(9_100_000), "9,1tr");
  assert.equal(compactVnd(850_000), "850k");
  assert.deepEqual(rowActions({ uses: 0, archived_at: null }), { edit: true, duplicate: true, copy: true, exportCsv: false, archive: true, unarchive: false, remove: true });
  assert.equal(rowActions({ uses: 3, archived_at: "2026-10-01T00:00:00Z" }).remove, false);
  assert.equal(rowActions({ uses: 3, archived_at: "2026-10-01T00:00:00Z" }).unarchive, true);
});

test("admin: customer preview and worked example", () => {
  const input = validateDraft(draftFromPromotion({ ...promo, ends_at: "2026-10-31T16:59:00Z", min_order_amount: 200000 })).input!;
  assert.equal(customerSees(input, money, () => "Proxy"), "Giảm 10% (tối đa 50.000 ₫) cho đơn đầu tiên Proxy từ 200.000 ₫. Mỗi khách 1 lần. Hết hạn 31/10/2026 23:59.");
  const sub = exampleSubtotal(input);
  assert.equal(sub, 300000);
  assert.equal(discountFor(input, sub), 30000);
  assert.equal(discountFor(input, 1_000_000), 50000, "capped");
  assert.equal(discountFor({ discount_type: "fixed", discount_value: 20000, max_discount_amount: null }, 10000), 10000);
});

test("admin: audit rows read as sentences", () => {
  assert.deepEqual(describeAudit({ event: "promotion_updated", details: { changes: { is_active: { old: true, new: false } } } }), { title: "Tạm dừng chiến dịch", detail: null });
  const edit = describeAudit({ event: "promotion_updated", details: { changes: { usage_limit: { old: null, new: 500 } } } });
  assert.equal(edit.detail, "Tổng lượt: trống → 500");
  assert.deepEqual(describeAudit({ event: "promotion_codes_created", details: { count: 200 } }), { title: "Tạo mã dùng 1 lần", detail: "200 mã" });
  assert.equal(describeAudit({ event: "something_new", details: {} }).title, "something_new");
});

test("admin: bulk single-use codes form", () => {
  const ok = validateBulkCodes({ promotionId: "4", prefix: "kol-", count: "200", length: "8" });
  assert.deepEqual(ok.body, { count: 200, prefix: "KOL-", length: 8 });
  assert.equal(ok.promotionId, 4);
  const bad = validateBulkCodes({ promotionId: "", prefix: "TOO-LONG-PREFIX", count: "5001", length: "5" });
  assert.deepEqual(Object.keys(bad.errors).sort(), ["count", "length", "prefix", "promotionId"]);
  assert.equal(sampleCode("KOL-", 6, () => 0), "KOL-AAAAAA");
});

test("money input keeps the caret after the same digit when regrouping", () => {
  // "100.000" → caret after "10|0.000", type 5 → raw "1050000" shown "1.050.000".
  const typed = "105|0.000".replace("|", "");
  const before = digitsBefore(typed, 3);
  assert.equal(before, 3);
  assert.equal(caretForDigits("1.050.000", before), 4, "caret right after the typed 5");
  // Deleting the dot's neighbour: "1.0|00" backspace → "1|00" → "100": caret after 1.
  assert.equal(caretForDigits("100", digitsBefore("1.00", 1)), 1);
  assert.equal(caretForDigits("1.000", 0), 0);
  assert.equal(caretForDigits("", 3), 0);
});
