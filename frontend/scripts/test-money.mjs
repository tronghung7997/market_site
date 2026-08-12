/**
 * Unit checks for display money math (mirrors frontend/lib/money/format.ts).
 * Run: node frontend/scripts/test-money.mjs
 *
 * Intent: total is always raw amount_vnd / rate, rounded once — never unit×qty
 * of already-rounded USD.
 */

const LEGACY = 26_000;

function formatLedgerMoney(amountVnd, locale = "en") {
  const n = Number.isFinite(amountVnd) ? amountVnd : 0;
  return new Intl.NumberFormat(locale === "vi" ? "vi-VN" : "en-US", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(n);
}

function isValidFxRate(rate) {
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0;
}

function formatUsd(amountVnd, locale, fxRate) {
  const usd = amountVnd / fxRate;
  if (!Number.isFinite(usd)) return formatLedgerMoney(amountVnd, locale);
  return new Intl.NumberFormat(locale === "vi" ? "vi-VN" : "en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(usd);
}

/** Browse / checkout: clean $x.xx or ₫x — no ≈ */
function formatCheckoutMoney(amountVnd, { locale = "en", currency, fxRate }) {
  if (currency === "USD" && isValidFxRate(fxRate)) {
    return formatUsd(amountVnd, locale, fxRate);
  }
  return formatLedgerMoney(amountVnd, locale);
}

const formatBrowseMoney = formatCheckoutMoney;

function formatOrderHistoryMoney(amountVnd, snapshot, currency) {
  if (currency !== "USD") {
    return { text: formatLedgerMoney(amountVnd), usedLegacyRate: false };
  }
  if (isValidFxRate(snapshot)) {
    return {
      text: formatUsd(amountVnd, "en", snapshot),
      usedLegacyRate: false,
    };
  }
  return {
    text: formatUsd(amountVnd, "en", LEGACY),
    usedLegacyRate: true,
  };
}

let failed = 0;
function assert(name, cond) {
  if (!cond) {
    console.error("FAIL:", name);
    failed += 1;
  } else {
    console.log("ok:", name);
  }
}

// 50000 VND @ 25500 → $1.96 (no ≈)
const s = formatBrowseMoney(50_000, { currency: "USD", fxRate: 25_500 });
assert("50000/25500 is $1.96", s.includes("1.96") && !s.startsWith("≈"));

// invalid rate → VND
const v = formatBrowseMoney(50_000, { currency: "USD", fxRate: null });
assert("invalid rate falls back to VND", v.includes("₫") || v.includes("VND") || v.includes("50"));

// historical uses snapshot not live
const h = formatOrderHistoryMoney(51_000, 25_500, "USD");
assert("snapshot used", h.text.includes("2.00") && !h.usedLegacyRate);

// legacy for null snapshot
const leg = formatOrderHistoryMoney(52_000, null, "USD");
assert("legacy rate 26000", leg.usedLegacyRate && leg.text.includes("2.00"));

// VND preference ignores rate
const pure = formatBrowseMoney(50_000, { currency: "VND", fxRate: 25_500 });
assert("VND preference", pure.includes("50") && !pure.startsWith("≈"));

// NaN safety
const nan = formatBrowseMoney(Number.NaN, { currency: "USD", fxRate: 25_500 });
assert("NaN amount safe", typeof nan === "string" && !nan.includes("NaN"));

// Checkout rounding: unit 50_000 @ 26_000 = $1.923… → display $1.92
// qty 2 total 100_000 / 26_000 = $3.846… → $3.85 (not $3.84 = 1.92×2)
const rate = 26_000;
const unitVnd = 50_000;
const qty = 2;
const totalVnd = unitVnd * qty; // raw total — never multiply rounded unit
const unitText = formatCheckoutMoney(unitVnd, { currency: "USD", fxRate: rate });
const totalText = formatCheckoutMoney(totalVnd, { currency: "USD", fxRate: rate });
assert("unit 50000@26000 → $1.92", unitText.includes("1.92") && !unitText.startsWith("≈"));
assert(
  "total 100000@26000 → $3.85 (not unit×qty $3.84)",
  totalText.includes("3.85") && !totalText.includes("3.84") && !totalText.startsWith("≈"),
);

// Sanity: wrong path would be round(unit)*qty
const wrong = Math.round((unitVnd / rate) * 100) / 100 * qty;
assert("naive unit×qty is 3.84", Math.abs(wrong - 3.84) < 1e-9);

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log("\nall money format checks passed");
