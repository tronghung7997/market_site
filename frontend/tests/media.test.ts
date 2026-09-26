import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { PrepareImageError, fitWithin, imageFilesFrom, prepareImage } from "../lib/media.ts";

describe("image preparation", () => {
  it("scales the longest edge down and never up", () => {
    assert.deepEqual(fitWithin(4032, 3024, 2560), { width: 2560, height: 1920 });
    assert.deepEqual(fitWithin(1080, 1920, 1600), { width: 900, height: 1600 });
    assert.deepEqual(fitWithin(800, 600, 2560), { width: 800, height: 600 });
  });

  it("rejects what is not an image before decoding", async () => {
    await assert.rejects(prepareImage(new Blob(["hello"], { type: "text/plain" })), (err: unknown) =>
      err instanceof PrepareImageError && err.reason === "not_image");
  });

  it("sends a GIF as-is unless it is over the upload cap", async () => {
    const gif = new Blob([new Uint8Array(1024)], { type: "image/gif" });
    assert.equal(await prepareImage(gif), gif);
    const huge = new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], { type: "image/gif" });
    await assert.rejects(prepareImage(huge), (err: unknown) => err instanceof PrepareImageError && err.reason === "too_large");
  });

  it("keeps only image files from a paste or drop", () => {
    const png = new File([new Uint8Array(4)], "a.png", { type: "image/png" });
    const txt = new File(["x"], "a.txt", { type: "text/plain" });
    const transfer = { files: [png, txt] } as unknown as DataTransfer;
    assert.deepEqual(imageFilesFrom(transfer), [png]);
    assert.deepEqual(imageFilesFrom(null), []);
  });
});

describe("private image sources", () => {
  it("builds the owning feature's endpoint with a thumb variant", async () => {
    const { privateImageBase, privateImageSource } = await import("../lib/media.ts");
    const source = privateImageSource({ id: "abcdefghijklmnop", w: 800, h: 600 }, privateImageBase.chat("c-1"));
    assert.deepEqual(source, {
      url: "/api/chat/conversations/c-1/attachments/abcdefghijklmnop",
      thumb_url: "/api/chat/conversations/c-1/attachments/abcdefghijklmnop?v=thumb",
      w: 800,
      h: 600,
    });
    assert.equal(privateImageBase.dispute("ORD-7X2"), "/api/orders/ORD-7X2/dispute/evidence");
  });

  it("keeps evidence files as picked", async () => {
    const file = new Blob([new Uint8Array(2_000_000)], { type: "image/jpeg" });
    assert.equal(await prepareImage(file, undefined, true), file);
  });
});
