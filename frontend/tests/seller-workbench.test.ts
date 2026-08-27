import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canUseSellerProviders } from "../lib/seller-tier.ts";
import {
  evaluateRouteAChecklist,
  evaluateRouteBChecklist,
  calculateB1Price,
  calculateB2Price,
  calculateB3Price,
  parseResourceLines,
  buyerContentToTranslation,
  hasCompleteLocalizedContent,
  buildDynamicPricingPlan,
  hydrateSellerProductDraft,
  effectivePriceInputCurrency,
  priceInputToVnd,
  vndToPriceInput,
} from "../features/seller-workbench/logic.ts";

describe("Seller Workbench Logic", () => {
  it("only enables private providers for trusted seller tiers", () => {
    assert.equal(canUseSellerProviders("new"), false);
    assert.equal(canUseSellerProviders("verified"), false);
    assert.equal(canUseSellerProviders("trusted"), true);
    assert.equal(canUseSellerProviders("enterprise"), true);
  });

  it("uses the current display currency for seller price entry while keeping VND ledger values", () => {
    assert.equal(effectivePriceInputCurrency("USD", 26_000), "USD");
    assert.equal(vndToPriceInput(87_880, "USD", 26_000), "3.38");
    assert.equal(priceInputToVnd("3.38", "USD", 26_000), 87_880);
    assert.equal(priceInputToVnd("0.000462", "USD", 26_000), 12);
    assert.equal(effectivePriceInputCurrency("USD", null), "VND");
    assert.equal(priceInputToVnd("87880", "VND", null), 87_880);
  });

  it("normalizes resource input without keeping blank or duplicate demo lines", () => {
    assert.deepEqual(
      parseResourceLines(" user1|pass1\n\nuser2|pass2\nuser1|pass1 "),
      ["user1|pass1", "user2|pass2"],
    );
    assert.deepEqual(parseResourceLines(""), []);
  });

  it("allows publishing with one complete seller-selected content language", () => {
    const content = {
      vi: {
        title: "Tài khoản Premium",
        description: "Mô tả tiếng Việt",
        highlightText: "Giao ngay",
        featuresText: "Bảo mật\nỔn định",
        specsText: "country: VN\nformat: user|pass",
        warrantyText: "Bảo hành 24 giờ",
      },
      en: {
        title: "Premium account",
        description: "English description",
        highlightText: "Instant delivery",
        featuresText: "Secure\nStable",
        specsText: "country: VN\nformat: user|pass",
        warrantyText: "24-hour warranty",
      },
    };

    assert.equal(hasCompleteLocalizedContent(content, "vi"), true);
    assert.equal(hasCompleteLocalizedContent(content, "en"), true);
    assert.deepEqual(buyerContentToTranslation(content.en), {
      title: "Premium account",
      description: "English description",
      highlight_text: "Instant delivery",
      features: ["Secure", "Stable"],
      specs: { country: "VN", format: "user|pass" },
      warranty_text: "24-hour warranty",
    });
    const viOnly = { ...content, en: { ...content.en, title: "", description: "" } };
    assert.equal(hasCompleteLocalizedContent(viOnly, "vi"), true);
    assert.equal(hasCompleteLocalizedContent(viOnly, "en"), false);
    assert.equal(
      hasCompleteLocalizedContent({ ...content, vi: { ...content.vi, description: "" } }, "vi"),
      false,
    );
  });

  it("hydrates the edit workbench from localized product and pricing data", () => {
    const draft = hydrateSellerProductDraft({
      id: 74,
      seller_id: 22,
      category_id: 9,
      title: "API credits",
      images: null,
      cover_id: "token",
      escrow_days: 30,
      status: "paused",
      service_type: "token",
      highlight_text: "Usage based",
      sold_count: 0,
      rating_avg: null,
      rating_count: 0,
      pricing_strategy: "credit",
      pricing_params: {
        credit_price: 12,
        packages: [{ size: 1000, label: "Legacy package label" }],
        volume_tiers: [{ min_qty: 1000, discount: 0.15 }],
      },
      primary_locale: "en",
      locale: null,
      available_locales: ["en"],
      created_at: "2026-08-25T00:00:00Z",
      description: "English description",
      features: ["Fast", "Audited"],
      specs: { region: "Global" },
      warranty_text: "30-day warranty",
      translations: {
        en: {
          title: "API credits",
          description: "English description",
          highlight_text: "Usage based",
          features: ["Fast", "Audited"],
          specs: { region: "Global" },
          warranty_text: "30-day warranty",
          pricing_labels: { package_labels: { "1000": "1,000 requests" } },
        },
      },
      variants: [],
      seller_name: "seller",
      category_name: "Cloud",
    });

    assert.equal(draft.primaryLocale, "en");
    assert.equal(draft.content.en.title, "API credits");
    assert.equal(draft.content.en.featuresText, "Fast\nAudited");
    assert.equal(draft.content.en.specsText, "region: Global");
    assert.deepEqual(draft.content.vi, {
      title: "",
      description: "",
      highlightText: "",
      featuresText: "",
      specsText: "",
      warrantyText: "",
    });
    assert.equal(draft.workModel, "B2");
    assert.equal(draft.b2.creditPrice, 12);
    assert.deepEqual(draft.b2.packages, [
      { size: 1000, label: "1,000 requests", discountPct: 15 },
    ]);
  });

  it("serializes each dynamic work model to the backend pricing contract", () => {
    const b1State = {
      basePrice: 50000,
      types: [{ key: "residential", label: "Residential", mult: 1.4 }],
      networks: [{ key: "fpt", label: "FPT", mult: 1 }],
      durations: [{ days: 30, label: "30 days" }],
      selectedType: "residential",
      selectedNetwork: "fpt",
      selectedDays: 30,
      qty: 1,
      isSingleUnit: false,
    };
    const b2State = {
      creditPrice: 200,
      packages: [{ size: 1000, label: "1,000 requests", discountPct: 10 }],
      selectedPackageSize: 1000,
    };
    const b3State = {
      basePrice: 30000,
      platforms: [{ key: "tiktok", label: "TikTok", mult: 1.2 }],
      selectedPlatform: "tiktok",
      urls: "",
    };

    const b1 = buildDynamicPricingPlan("B1", b1State, b2State, b3State);
    assert.equal(b1.strategy, "config");
    assert.deepEqual(b1.params.type_mult, { residential: 1.4 });
    assert.deepEqual(b1.params.duration_options, [{ days: 30, label: "30 days" }]);

    const b2 = buildDynamicPricingPlan("B2", b1State, b2State, b3State);
    assert.equal(b2.strategy, "credit");
    assert.deepEqual(b2.params.packages, [{ size: 1000, label: "1,000 requests" }]);

    const b3 = buildDynamicPricingPlan("B3", b1State, b2State, b3State);
    assert.equal(b3.strategy, "task");
    assert.deepEqual(b3.params.platform_mult, { tiktok: 1.2 });
  });

  it("evaluates Route A as not sellable when variants list is empty", () => {
    const res = evaluateRouteAChecklist({
      title: "Netflix Account",
      description: "Good account",
      variants: [],
      escrowDays: 30,
    });
    assert.equal(res.isSellable, false);
    assert.equal(res.passCount, 2); // info & escrow pass, variant & stock fail
  });

  it("evaluates Route A as sellable when 1 instant variant has stock", () => {
    const res = evaluateRouteAChecklist({
      title: "Netflix Account",
      description: "Good account",
      variants: [
        { name: "1 Month", price: 85000, delivery_mode: "instant", stock_count: 10, is_active: true },
      ],
      escrowDays: 30,
    });
    assert.equal(res.isSellable, true);
    assert.equal(res.passCount, 4);
  });

  it("evaluates Route A as sellable when 1 variant is OOS but another is available", () => {
    const res = evaluateRouteAChecklist({
      title: "Netflix Account",
      description: "Good account",
      variants: [
        { name: "1 Month", price: 85000, delivery_mode: "instant", stock_count: 0, is_active: true },
        { name: "3 Month", price: 240000, delivery_mode: "instant", stock_count: 5, is_active: true },
      ],
      escrowDays: 30,
    });
    assert.equal(res.isSellable, true);
  });

  it("calculates B1 config price correctly without rounding errors", () => {
    const res = calculateB1Price({
      basePrice: 50000,
      types: [{ key: "res", label: "Residential", mult: 1.4 }],
      networks: [{ key: "fpt", label: "FPT", mult: 1.0 }],
      durations: [{ days: 30, label: "30 Days" }],
      selectedType: "res",
      selectedNetwork: "fpt",
      selectedDays: 30,
      qty: 1,
      isSingleUnit: false,
    });
    assert.equal(res.total, 70000);
    assert.equal(res.valid, true);
  });

  it("calculates B2 credit price with volume discount tier", () => {
    const res = calculateB2Price({
      creditPrice: 200,
      packages: [
        { size: 1000, label: "Gói 1.000 lượt", discountPct: 10 },
      ],
      selectedPackageSize: 1000,
    });
    assert.equal(res.rawTotal, 200000);
    assert.equal(res.finalTotal, 180000);
    assert.equal(res.discountPct, 10);
  });

  it("calculates B3 task price based on line count of URLs", () => {
    const res = calculateB3Price({
      basePrice: 30000,
      platforms: [{ key: "tiktok", label: "TikTok", mult: 1.2 }],
      selectedPlatform: "tiktok",
      urls: "https://tiktok.com/@user1\nhttps://tiktok.com/@user2\nhttps://tiktok.com/@user3\n",
    });
    assert.equal(res.urlCount, 3);
    assert.equal(res.perUrlPrice, 36000);
    assert.equal(res.total, 108000);
    assert.equal(res.valid, true);
  });

  it("evaluates Route B as blocked when backend is mismatch or pending", () => {
    const pendingRes = evaluateRouteBChecklist({
      title: "API Service",
      description: "Description",
      workModel: "B2",
      priceValid: true,
      backend: { status: "pending", name: "My Server" },
      escrowDays: 3,
    });
    assert.equal(pendingRes.isSellable, false);

    const approvedRes = evaluateRouteBChecklist({
      title: "API Service",
      description: "Description",
      workModel: "B2",
      priceValid: true,
      backend: { status: "approved", name: "My Server" },
      escrowDays: 3,
    });
    assert.equal(approvedRes.isSellable, true);
  });
});
