import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { describeSettingsEvent, requestChanges, settingsChanges, settingsSummary } from "../features/admin-logs/settings-audit.ts";

const row = (label: string, before: string, after: string) => ({ label, before, after });
const plain = (md: Record<string, unknown>) => settingsChanges(md).map(({ label, before, after }) => row(label, before, after));

describe("settings audit rows", () => {
  it("formats fee & escrow changes per field with units", () => {
    const md = {
      event: "fee_runtime_config_changed",
      changed: {
        platform_fee_percent: [5, 6.5],
        escrow_default_hours: [48, 36],
        withdraw_fee_fixed: [0, 2000],
        dispute_seller_response_hours: [24, 48],
        dispute_evidence_image_required: [false, true],
      },
      old: {}, new: {},
    };
    assert.deepEqual(plain(md), [
      row("Phí sàn", "5%", "6,5%"),
      row("Giữ tiền mặc định", "2 ngày", "36 giờ"),
      row("Phí rút cố định", "0 ₫", "2.000 ₫"),
      row("Hạn người bán phản hồi khiếu nại", "24 giờ", "48 giờ"),
      row("Bắt buộc ảnh bằng chứng khiếu nại", "Tắt", "Bật"),
    ]);
    assert.equal(describeSettingsEvent(md), "Đổi phí & giữ tiền: Phí sàn: 5% → 6,5% · Giữ tiền mặc định: 2 ngày → 36 giờ · +3 thay đổi");
  });

  it("expands per-category maps with the logged category names", () => {
    const md = {
      event: "fee_runtime_config_changed",
      changed: {
        category_fee_percent: [{ "7": 5, "9": 3 }, { "7": 8, "9": 3, "12": 2 }],
        category_escrow_min_hours: [{ "7": 96 }, {}],
      },
      labels: { categories: { "7": "Proxy", "12": "Tài khoản" } },
    };
    assert.deepEqual(plain(md), [
      row("Phí sàn · Proxy", "5%", "8%"),
      row("Phí sàn · Tài khoản", "Theo mức chung", "2%"),
      row("Giữ tiền tối thiểu · Proxy", "4 ngày", "Theo mức chung"),
    ]);
  });

  it("reads the platform hold floor", () => {
    assert.deepEqual(plain({ event: "fee_runtime_config_changed", changed: { escrow_floor_hours: [24, 12] } }), [
      row("Sàn giữ tiền (mọi đơn)", "1 ngày", "12 giờ"),
    ]);
  });

  it("still reads entries logged while holds were in days", () => {
    const md = {
      event: "fee_runtime_config_changed",
      changed: { escrow_default_days: [2, 3], category_escrow_min_days: [{}, { "7": 4 }], dispute_open_window_hours: [0, 6] },
      labels: { categories: { "7": "Proxy" } },
    };
    assert.deepEqual(plain(md), [
      row("Giữ tiền mặc định", "2 ngày", "3 ngày"),
      row("Giữ tiền tối thiểu · Proxy", "Theo mức chung", "4 ngày"),
      row("Thời gian tối đa mở khiếu nại", "0 giờ", "6 giờ"),
    ]);
  });

  it("falls back to the category id when no name was logged", () => {
    const md = { event: "fee_runtime_config_changed", changed: { category_fee_percent: [{}, { "3": 1 }] } };
    assert.deepEqual(plain(md), [row("Phí sàn · danh mục #3", "Theo mức chung", "1%")]);
  });

  it("names the tier for seller tier rule changes", () => {
    const md = {
      event: "seller_tier_config_changed",
      changed: { trusted: { fee_discount_pp: [1, 2], withdraw_limit_per_request: [5_000_000, null] }, new: { escrow_reduction_hours: [0, 12] }, enterprise: { escrow_reduction_days: [1, 2] } },
      old: {},
    };
    assert.deepEqual(plain(md), [
      row("Hạng Uy tín · Giảm phí sàn", "1 điểm %", "2 điểm %"),
      row("Hạng Uy tín · Hạn mức mỗi lệnh rút", "5.000.000 ₫", "Không giới hạn"),
      row("Hạng Mới · Giảm giờ giữ tiền", "0 giờ", "12 giờ"),
      row("Hạng Doanh nghiệp · Giảm ngày giữ tiền", "1 ngày", "2 ngày"),
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

  it("reads affiliate programme and per-account (KOL) terms", () => {
    const kol = {
      event: "affiliate_account_terms_changed",
      old: { commission_percent_of_fee: null, earning_days: null },
      new: { commission_percent_of_fee: 20, earning_days: 0 },
    };
    assert.deepEqual(plain(kol), [
      row("Hoa hồng giới thiệu (% phí sàn)", "Theo mức chung", "20%"),
      row("Thời gian hưởng hoa hồng", "Theo mức chung", "Trọn đời"),
    ]);
    assert.match(describeSettingsEvent(kol), /^Đổi hoa hồng riêng \(KOL\): /);
    const programme = {
      event: "affiliate_runtime_config_changed",
      old: { commission_percent_of_fee: 0, attribution_days: 30, earning_days: 0 },
      new: { commission_percent_of_fee: 20, attribution_days: 30, earning_days: 365 },
    };
    assert.deepEqual(plain(programme), [
      row("Hoa hồng giới thiệu (% phí sàn)", "0%", "20%"),
      row("Thời gian hưởng hoa hồng", "Trọn đời", "365 ngày"),
    ]);
  });

  it("says nothing changed for a no-op save and ignores other events", () => {
    assert.equal(describeSettingsEvent({ event: "fee_runtime_config_changed", changed: {} }), "Đổi phí & giữ tiền: không đổi giá trị nào");
    assert.deepEqual(settingsChanges({ event: "order_placed", old: 1, new: 2 }), []);
    assert.equal(settingsSummary([]), "không đổi giá trị nào");
  });

  it("labels ops bot changes, token only as its hint", () => {
    const md = {
      event: "ops_telegram_config_changed",
      changed: {
        ops_enabled: [false, true],
        ops_bot_token: [null, "…mWq7"],
        ops_chat_id: ["", "-1001234567890"],
        ops_channel_interval_minutes: [30, 60],
        "ops_event.system_alert": [true, false],
      },
    };
    assert.deepEqual(plain(md), [
      row("Bot vận hành", "Tắt", "Bật"),
      row("Token bot vận hành", "—", "…mWq7"),
      row("Nhóm vận hành", "—", "-1001234567890"),
      row("Khoảng cách giữa 2 bài kênh", "30 phút", "60 phút"),
      row("Báo cảnh báo hệ thống", "Bật", "Tắt"),
    ]);
    assert.ok(describeSettingsEvent(md).startsWith("Đổi bot vận hành: Bot vận hành: Tắt → Bật"));
  });

  it("renders system, money and deposit changes with their units", () => {
    const md = {
      event: "site_runtime_config_changed",
      changed: { announcement_level: ["info", "danger"], media_max_upload_mb: [10, 5], announcement_text_vi: [null, "Bảo trì 22h"] },
    };
    assert.deepEqual(plain(md), [
      row("Mức thông báo", "Thông tin", "Khẩn"),
      row("Dung lượng ảnh tối đa", "10 MB", "5 MB"),
      row("Nội dung thông báo (VI)", "—", "Bảo trì 22h"),
    ]);
    assert.deepEqual(plain({ event: "deposit_rail_config_changed", changed: { deposit_min_amount: [10_000, 20_000], deposit_expire_minutes: [30, 60] } }), [
      row("Nạp chuyển khoản tối thiểu", "10.000 ₫", "20.000 ₫"),
      row("Hạn yêu cầu nạp", "30 phút", "60 phút"),
    ]);
  });

  it("flattens the seller trust document into per-criterion rows", () => {
    const md = {
      event: "seller_trust_config_changed",
      old: { window_days: 90, score: { gmv: { points: 30 } }, criteria: { trusted: { min_gmv: 50_000_000 } } },
      new: { window_days: 60, score: { gmv: { points: 30 } }, criteria: { trusted: { min_gmv: 60_000_000 } } },
    };
    assert.deepEqual(plain(md), [
      row("Cửa sổ tính điểm uy tín", "90 ngày", "60 ngày"),
      row("Tiêu chí · hạng Uy tín · GMV tối thiểu", "50.000.000 ₫", "60.000.000 ₫"),
    ]);
  });

  it("renders an approval request diff like the section's own change", () => {
    const req = { settings_event: "fee_runtime_config_changed", diff: { platform_fee_percent: [0, 12.5], category_fee_percent: [{}, { "7": 20 }] }, context: { categories: { "7": "Proxy" } } };
    assert.deepEqual(requestChanges(req).map(({ label, before, after }) => row(label, before, after)), [
      row("Phí sàn", "0%", "12,5%"),
      row("Phí sàn · Proxy", "Theo mức chung", "20%"),
    ]);
    assert.deepEqual(requestChanges({ settings_event: "seller_tier_config_changed", diff: { verified: { fee_discount_pp: [0, 3] } }, context: null })
      .map(({ label, before, after }) => row(label, before, after)), [row("Hạng Đã xác minh · Giảm phí sàn", "0 điểm %", "3 điểm %")]);
    assert.deepEqual(requestChanges({ settings_event: null, diff: { a: [1, 2] }, context: null }), []);
    const logged = {
      event: "config_change_requested", section_label: "Phí & giữ tiền", settings_event: "fee_runtime_config_changed",
      changed: { platform_fee_percent: [0, 12.5] },
    };
    assert.deepEqual(plain(logged), [row("Phí sàn", "0%", "12,5%")]);
    assert.equal(describeSettingsEvent(logged), "Gửi yêu cầu đổi cấu hình · Phí & giữ tiền: Phí sàn: 0% → 12,5%");
  });

  it("reads tier fee %, buyer tier and automatic-tier settings", () => {
    assert.deepEqual(plain({
      event: "seller_tier_config_changed",
      changed: { new: { fee_percent: [null, 10] }, trusted: { fee_percent: [2, 3] } },
    }), [
      row("Hạng Mới · Phí giao dịch", "Mặc định sàn", "10%"),
      row("Hạng Uy tín · Phí giao dịch", "2%", "3%"),
    ]);
    assert.deepEqual(plain({
      event: "buyer_tier_config_changed",
      changed: { criterion: ["total_spent", "total_deposit"], ip_requests_per_minute: [500, 2000], "l2.min_amount": [25000000, 500], "l3.api_requests_per_minute": [null, 500] },
    }), [
      row("Điều kiện xét hạng người mua", "Tổng tiêu", "Tổng nạp"),
      row("Request API mỗi IP/phút", "500", "2.000"),
      row("Hạng người mua L2 · Ngưỡng", "25.000.000 ₫", "500 ₫"),
      row("Hạng người mua L3 · API request/phút", "Không giới hạn", "500"),
    ]);
    const trust = {
      event: "seller_trust_config_changed",
      old: { window_days: 90, criteria: { verified: { max_dispute_pct: 8, min_gmv: null } }, auto: { enabled: true, grace_days: 14 } },
      new: { window_days: 90, criteria: { verified: { max_dispute_pct: 5, min_gmv: 1000 } }, auto: { enabled: false, grace_days: 7 } },
    };
    assert.deepEqual(plain(trust), [
      row("Tiêu chí · hạng Đã xác minh · tỷ lệ khiếu nại tối đa", "8%", "5%"),
      row("Tiêu chí · hạng Đã xác minh · GMV tối thiểu", "—", "1.000 ₫"),
      row("Xét hạng tự động", "Bật", "Tắt"),
      row("Thời gian ân hạn", "14 ngày", "7 ngày"),
    ]);
    // An approval request flattens the buyer document ("levels.l2.…").
    assert.deepEqual(requestChanges({ settings_event: "buyer_tier_config_changed", diff: { "levels.l2.cashback_percent": [1, 2] }, context: null })
      .map(({ label, before, after }) => row(label, before, after)), [row("Hạng người mua L2 · Hoàn tiền", "1%", "2%")]);
    assert.deepEqual(requestChanges({ settings_event: "seller_tier_config_changed", diff: { verified: { fee_percent: [null, 6] } }, context: null })
      .map(({ label, before, after }) => row(label, before, after)), [row("Hạng Đã xác minh · Phí giao dịch", "Mặc định sàn", "6%")]);
  });
});
