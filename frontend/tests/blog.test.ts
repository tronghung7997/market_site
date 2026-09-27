import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  blogListHref, isMeaningfulUpdate, postJsonLd, readPostCategory, readingMinutes,
} from "../features/blog/model.ts";
import { createHeadingSlugger, extractHeadings } from "../lib/heading-slug.ts";
import { jsonLdHtml } from "../lib/json-ld.ts";

const words = (n: number) => Array.from({ length: n }, () => "chữ").join(" ");

describe("blog reading time", () => {
  it("rounds to whole minutes and never shows zero", () => {
    assert.equal(readingMinutes(""), 1);
    assert.equal(readingMinutes(words(40)), 1);
    assert.equal(readingMinutes(words(690)), 3);
  });

  it("does not count code blocks, link targets or markdown punctuation", () => {
    const code = "```\n" + words(2000) + "\n```";
    assert.equal(readingMinutes(`## Tiêu đề\n\n${code}\n\n[Mở ví](https://example.com/a/very/long/path)`), 1);
  });
});

describe("blog post dates", () => {
  it("shows an update only a day or more after publishing", () => {
    assert.equal(isMeaningfulUpdate("2026-09-27T10:00:00Z", "2026-09-27T18:00:00Z"), false);
    assert.equal(isMeaningfulUpdate("2026-09-27T10:00:00Z", "2026-09-28T10:00:00Z"), true);
  });
});

describe("blog list URLs", () => {
  it("accepts only known categories", () => {
    assert.equal(readPostCategory("guide"), "guide");
    assert.equal(readPostCategory("hack"), null);
    assert.equal(readPostCategory(["guide"]), null);
    assert.equal(readPostCategory(undefined), null);
  });

  it("has one spelling per list view", () => {
    assert.equal(blogListHref({ category: null, page: 1 }), "/blog");
    assert.equal(blogListHref({ category: "news", page: 1 }), "/blog?category=news");
    assert.equal(blogListHref({ category: null, page: 3 }), "/blog?page=3");
    assert.equal(blogListHref({ category: "guide", page: 2 }), "/blog?category=guide&page=2");
  });
});

describe("blog post structured data", () => {
  const base = {
    origin: "https://gmmo.example",
    url: "https://gmmo.example/vi/blog/mua-hang",
    siteName: "GMMO",
    homeUrl: "https://gmmo.example/vi",
    blogUrl: "https://gmmo.example/vi/blog",
    blogName: "Hướng dẫn & tin tức",
    section: "Hướng dẫn",
  };
  const post = {
    title: "Mua hàng lần đầu",
    excerpt: "Tóm tắt",
    cover: { url: "/media/public/cover.webp", thumb_url: null, w: 1600, h: 838 },
    published_at: "2026-09-27T10:00:00Z",
    updated_at: "2026-09-28T10:00:00Z",
  };

  it("describes the post as a BlogPosting with absolute URLs and a breadcrumb", () => {
    const [article, breadcrumb] = postJsonLd({ post: post as never, ...base })["@graph"];
    assert.equal(article["@type"], "BlogPosting");
    assert.equal(article.headline, "Mua hàng lần đầu");
    assert.deepEqual(article.image, ["https://gmmo.example/media/public/cover.webp"]);
    assert.equal(article.datePublished, post.published_at);
    assert.equal(article.dateModified, post.updated_at);
    assert.deepEqual(article.author, { "@type": "Organization", name: "GMMO", url: "https://gmmo.example" });
    assert.deepEqual(breadcrumb.itemListElement.map((i: { position: number; item: string }) => [i.position, i.item]), [
      [1, "https://gmmo.example/vi"],
      [2, "https://gmmo.example/vi/blog"],
      [3, "https://gmmo.example/vi/blog/mua-hang"],
    ]);
  });

  it("leaves out image and description the post does not have", () => {
    const [article] = postJsonLd({ post: { ...post, excerpt: "", cover: null } as never, ...base })["@graph"];
    assert.equal("image" in article, false);
    assert.equal("description" in article, false);
  });

  it("cannot close the script tag it is embedded in", () => {
    const html = jsonLdHtml({ name: "x</script><img src=x onerror=alert(1)>" });
    assert.equal(html.includes("<"), false);
    assert.deepEqual(JSON.parse(html), { name: "x</script><img src=x onerror=alert(1)>" });
  });
});

describe("markdown heading ids", () => {
  it("gives repeated headings distinct ids in page order", () => {
    const slug = createHeadingSlugger();
    assert.deepEqual(["Lưu ý", "Lưu ý", "Điều khoản", "Lưu ý"].map(slug), ["luu-y", "luu-y-1", "dieu-khoan", "luu-y-2"]);
  });

  it("lists ## and ### for the table of contents with the same ids as the page", () => {
    const md = [
      "# Lưu ý",
      "## Lưu ý",
      "```",
      "## not a heading",
      "```",
      "### **Nạp** tiền",
      "#### Lưu ý",
      "## Lưu ý",
    ].join("\n");
    assert.deepEqual(extractHeadings(md), [
      { level: 2, text: "Lưu ý", id: "luu-y-1" },
      { level: 3, text: "Nạp tiền", id: "nap-tien" },
      { level: 2, text: "Lưu ý", id: "luu-y-3" },
    ]);
  });
});
