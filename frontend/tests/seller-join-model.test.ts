import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { applyPayload, canSubmit, EMPTY_DRAFT, parseDraft, stepErrors } from "../features/seller-join/model.ts";

const ready = { ...EMPTY_DRAFT, businessName: "Kho Số", categoryIds: [3, 5], acceptRules: true };

describe("seller application wizard", () => {
  it("requires a name and a category on the shop step", () => {
    assert.deepEqual(stepErrors("shop", EMPTY_DRAFT), ["nameRequired", "categoryRequired"]);
    assert.deepEqual(stepErrors("shop", { ...ready, businessName: "x".repeat(256) }), ["nameTooLong"]);
    assert.deepEqual(stepErrors("shop", { ...ready, categoryIds: Array.from({ length: 13 }, (_, i) => i) }), ["tooManyCategories"]);
    assert.deepEqual(stepErrors("shop", ready), []);
  });

  it("checks the phone format and the rules on the contact step", () => {
    assert.deepEqual(stepErrors("contact", { ...ready, acceptRules: false }), ["rulesRequired"]);
    assert.deepEqual(stepErrors("contact", { ...ready, phone: "call me" }), ["phoneInvalid"]);
    assert.deepEqual(stepErrors("contact", { ...ready, phone: "+84 912 345 678" }), []);
    assert.equal(canSubmit(ready), true);
    assert.equal(canSubmit({ ...ready, acceptRules: false }), false);
  });

  it("builds the request body and drops empty optional answers", () => {
    const body = applyPayload({ ...ready, description: "  ", phone: " 0912 345 678 ", experience: "1_3y" });
    assert.deepEqual(body, {
      business_name: "Kho Số",
      description: undefined,
      contact: undefined,
      seller_type: "individual",
      category_ids: [3, 5],
      experience: "1_3y",
      phone: "0912 345 678",
      warranty_policy: undefined,
      referral_source: undefined,
      accept_rules: true,
    });
  });

  it("restores a draft defensively and never restores the rules tick", () => {
    const saved = JSON.stringify({ ...ready, sellerType: "company", categoryIds: [1, "2", 3.5, 4], experience: "forever" });
    const draft = parseDraft(saved)!;
    assert.equal(draft.businessName, "Kho Số");
    assert.equal(draft.sellerType, "individual");
    assert.deepEqual(draft.categoryIds, [1, 4]);
    assert.equal(draft.experience, "");
    assert.equal(draft.acceptRules, false);
    assert.equal(parseDraft("not json"), null);
    assert.equal(parseDraft(null), null);
  });
});
