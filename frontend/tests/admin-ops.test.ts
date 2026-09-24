import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { matchesSearch, playbook, primaryActionLabel, sortAlerts } from "../features/admin-alerts/model.ts";
import { describeMetadata } from "../features/admin-logs/model.ts";
import { caseDeadlines, countdown, suggestedAction } from "../features/admin-disputes/model.ts";
import type { AdminAlert, AdminDisputeCase } from "../lib/types.ts";

function alert(over: Partial<AdminAlert>): AdminAlert {
  return {
    id: 1, type: "sla_breach", severity: "warning", target_type: "seller", target_id: 7, message: "Đơn trễ hạn",
    is_active: true, created_at: "2026-09-24T01:00:00Z", first_seen_at: null, last_seen_at: "2026-09-24T01:00:00Z",
    occurrence_count: 1, resolved_at: null, admin_resolved_at: null, admin_resolved_by: null, admin_note: null,
    audience: "user", href: null, refs: [], ...over,
  };
}

describe("admin alerts model", () => {
  it("orders by severity, then most recent occurrence", () => {
    const rows = sortAlerts([
      alert({ id: 1, severity: "warning", last_seen_at: "2026-09-24T05:00:00Z" }),
      alert({ id: 2, severity: "critical", last_seen_at: "2026-09-20T00:00:00Z" }),
      alert({ id: 3, severity: "warning", last_seen_at: "2026-09-24T06:00:00Z" }),
    ], "open");
    assert.deepEqual(rows.map((a) => a.id), [2, 3, 1]);
  });

  it("searches the resolved records, not just the message", () => {
    const a = alert({ refs: [{ kind: "account", id: 7, label: "Kho 247", detail: "kho247@example.com", href: "/admin/accounts?account=7" }] });
    assert.ok(matchesSearch(a, "kho247@"));
    assert.ok(matchesSearch(a, "trễ hạn"));
    assert.ok(!matchesSearch(a, "proxy"));
  });

  it("names the primary action after the record it opens and knows every playbook", () => {
    assert.equal(primaryActionLabel({ kind: "dispute", id: 1, label: "ORD-1", detail: null, href: "/x" }), "Mở khiếu nại");
    assert.equal(primaryActionLabel(undefined), "Không có đối tượng");
    assert.ok(playbook(alert({})).steps.length > 0);
    assert.equal(playbook(alert({ type: "unknown_kind", message: "raw" })).impact, "raw");
  });
});

describe("admin log metadata", () => {
  it("turns old/new pairs into changes and hides ids shown as linked records", () => {
    const { fields, changes } = describeMetadata({
      event: "tier_changed", actor_id: 1, seller_id: 7, old_tier: "new", new_tier: "trusted",
      amount: 150000, outcome: "success", action: "replace", ip: "1.2.3.4",
    });
    assert.deepEqual(changes, [{ key: "tier", label: "Tier", before: "new", after: "trusted" }]);
    const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
    assert.equal(byKey.amount.value, "150.000 ₫");
    assert.equal(byKey.outcome.value, "Thành công");
    assert.equal(byKey.action.value, "Đổi hàng");
    for (const hidden of ["event", "actor_id", "seller_id", "ip"]) assert.ok(!(hidden in byKey), hidden);
  });
});

describe("admin dispute case model", () => {
  const base = {
    status: "open", seller_deadline_at: "2026-09-24T02:00:00Z", seller_responded_at: null,
    resolution_deadline_at: null, abandon_after_at: null,
    order: { escrow_expires_at: "2026-09-26T00:00:00Z" },
    recommendation: { action: "partial_refund", text: "", amount: 18000 },
  } as unknown as AdminDisputeCase;

  it("lists open-case clocks soonest first and flags overdue ones", () => {
    const now = Date.parse("2026-09-24T03:00:00Z");
    const d = caseDeadlines(base, now);
    assert.deepEqual(d.map((x) => [x.key, x.overdue]), [["seller", true], ["escrow", false]]);
    assert.equal(caseDeadlines({ ...base, status: "resolved_refund" } as AdminDisputeCase, now).length, 0);
    assert.equal(countdown("2026-09-24T01:00:00Z", now), "quá 2 giờ");
    assert.equal(countdown("2026-09-27T03:00:00Z", now), "còn 3 ngày");
  });

  it("maps only actionable recommendations to a decision", () => {
    assert.equal(suggestedAction(base), "partial_refund");
    assert.equal(suggestedAction({ ...base, recommendation: { action: "wait", text: "", amount: null } } as AdminDisputeCase), null);
  });
});
