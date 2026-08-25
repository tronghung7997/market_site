import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { COVER_IDS, categoryCoverId, coverSrc, isCoverId, parseCoverId } from "../lib/product-covers.ts";

const coversDir = join(dirname(fileURLToPath(import.meta.url)), "../public/covers");

describe("product covers", () => {
  it("maps every allowlisted id to a public svg", () => {
    const files = new Set(readdirSync(coversDir));
    for (const id of COVER_IDS) {
      assert.equal(coverSrc(id), `/covers/${id}.svg`);
      assert.ok(files.has(`${id}.svg`), `missing public/covers/${id}.svg`);
    }
  });

  it("rejects unknown ids and legacy image blobs", () => {
    assert.equal(isCoverId("facebook"), true);
    assert.equal(isCoverId("not-a-cover"), false);
    assert.equal(coverSrc("not-a-cover"), null);
    assert.equal(parseCoverId({ cover_id: "proxy" }), "proxy");
    assert.equal(parseCoverId({ images: { cover_id: "tiktok" } }), "tiktok");
    assert.equal(parseCoverId({ image: "account" }), "account");
    assert.equal(parseCoverId({ images: ["http://old.example/a.png"] }), null);
    assert.equal(parseCoverId({ cover_id: "Facebook" }), null);
  });

  it("resolves a category cover from icon, then name/slug", () => {
    assert.equal(categoryCoverId({ icon: "proxy", name: "Facebook" }), "proxy");
    assert.equal(categoryCoverId({ icon: null, name: "Facebook Ads" }), "facebook");
    assert.equal(categoryCoverId({ icon: "nope", name: "Cloud & Server", slug: "cloud" }), "cloud");
    assert.equal(categoryCoverId({ icon: null, name: "Mạng xã hội", slug: "social" }), "account");
    assert.equal(categoryCoverId({ icon: null, name: "Misc", slug: "misc" }), "other");
  });
});
