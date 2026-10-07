import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { describeSettingsEvent, settingsChanges, settingsSummary } from "../features/admin-logs/settings-audit.ts";

const row = (label: string, before: string, after: string) => ({ label, before, after });
const plain = (md: Record<string, unknown>) => settingsChanges(md).map(({ label, before, after }) => row(label, before, after));

describe("settings audit rows", () => {
  it("formats fee & escrow changes per field with units", () => {
    const md = {
      event: "fee_runtime_config_changed",
      changed: {
        platform_fee_percent: [5, 6.5],
        escrow_default_days: [3, 5],
        withdraw_fee_fixed: [0, 2000],
        dispute_seller_response_hours: [24, 48],
        dispute_evidence_image_required: [false, true],
      },
      old: {}, new: {},
    };
    assert.deepEqual(plain(md), [
      row("Phí sàn", "5%", "6,5%"),
      row("Giữ tiền mặc định", "3 ngày", "5 ngày"),
      row("Phí rút cố định", "0 ₫", "2.000 ₫"),
      row("Hạn người bán phản hồi khiếu nại", "24 giờ", "48 giờ"),
      row("Bắt buộc ảnh bằng chứng khiếu nại", "Tắt", "Bật"),
    ]);
    assert.equal(describeSettingsEvent(md), "Đổi phí & giữ tiền: Phí sàn: 5% → 6,5% · Giữ tiền mặc định: 3 ngày → 5 ngày · +3 thay đổi");
  });

  it("expands per-category maps with the logged category names", () => {
    const md = {
      event: "fee_runtime_config_changed",
      changed: {
        category_fee_percent: [{ "7": 5, "9": 3 }, { "7": 8, "9": 3, "12": 2 }],
        category_escrow_min_days: [{ "7": 4 }, {}],
      },
      labels: { categories: { "7": "Proxy", "12": "Tài khoản" } },
    };
    assert.deepEqual(plain(md), [
      row("Phí sàn · Proxy", "5%", "8%"),
      row("Phí sàn · Tài khoản", "Theo mức chung", "2%"),
      row("Giữ tiền tối thiểu · Proxy", "4 ngày", "Theo mức chung"),
    ]);
  });

  it("falls back to the category id when no name was logged", () => {
    const md = { event: "fee_runtime_config_changed", changed: { category_fee_percent: [{}, { "3": 1 }] } };
    assert.deepEqual(plain(md), [row("Phí sàn · danh mục #3", "Theo mức chung", "1%")]);
  });

  it("names the tier for seller tier rule changes", () => {
    const md = {
      event: "seller_tier_config_changed",
      changed: { trusted: { fee_discount_pp: [1, 2], withdraw_limit_per_request: [5_000_000, null] }, new: { escrow_reduction_days: [0, 1] } },
      old: {},
    };
    assert.deepEqual(plain(md), [
      row("Hạng Uy tín · Giảm phí sàn", "1 điểm %", "2 điểm %"),
      row("Hạng Uy tín · Hạn mức mỗi lệnh rút", "5.000.000 ₫", "Không giới hạn"),
      row("Hạng Mới · Giảm ngày giữ tiền", "0 ngày", "1 ngày"),
    ]);
  });

  it("diffs old/new snapshots when the event has no changed map", () => {
    const md = {
      event: "seller_runtime_config_changed",
      old: { low_stock_threshold: 20, auto_review_enabled: true, review_window_days: 7 },
      new: { low_stock_threshold: 30, auto_review_enabled: false, review_window_days: 7 },
    };
    assert.deepEqual(plain(md), [
      row("Ngưỡng báo sắp hết hàng", "20", "30"),
      row("Tự đánh giá", "Bật", "Tắt"),
    ]);
  });

  it("says nothing changed for a no-op save and ignores other events", () => {
    assert.equal(describeSettingsEvent({ event: "fee_runtime_config_changed", changed: {} }), "Đổi phí & giữ tiền: không đổi giá trị nào");
    assert.deepEqual(settingsChanges({ event: "order_placed", old: 1, new: 2 }), []);
    assert.equal(settingsSummary([]), "không đổi giá trị nào");
  });
});
