import assert from "node:assert/strict";
import test from "node:test";

import { facebookEntityType, facebookIdLink, facebookShortQuery, normalizeFacebookTarget } from "../lib/facebook-lookup.ts";
import { lookupFromOwnFrontend, resolveLookupEndpoint, withLookupApiKey } from "../lib/lookup-gateway.ts";

const target = (input: string) => normalizeFacebookTarget(input);

test("usernames, @handles and numeric ids become canonical facebook.com urls", () => {
  assert.deepEqual(target("bui.v.phu"), { url: "https://www.facebook.com/bui.v.phu", handle: "bui.v.phu", kind: "username" });
  assert.deepEqual(target("  @zuck "), { url: "https://www.facebook.com/zuck", handle: "zuck", kind: "username" });
  assert.deepEqual(target("100000020535380"), { url: "https://www.facebook.com/100000020535380", handle: "100000020535380", kind: "numeric" });
});

test("profile, mobile and post links collapse to the owner", () => {
  assert.equal(target("https://www.facebook.com/bui.v.phu")?.url, "https://www.facebook.com/bui.v.phu");
  assert.equal(target("m.facebook.com/bui.v.phu/")?.url, "https://www.facebook.com/bui.v.phu");
  assert.equal(target("https://web.facebook.com/bui.v.phu/posts/pfbid0abc?mibextid=xyz")?.url, "https://www.facebook.com/bui.v.phu");
  assert.equal(target("https://www.facebook.com/profile.php?id=100000020535380&sk=about")?.handle, "profile.php?id=100000020535380");
  assert.equal(target("https://www.facebook.com/story.php?story_fbid=1&id=100000020535380")?.url, "https://www.facebook.com/profile.php?id=100000020535380");
  assert.equal(target("https://www.facebook.com/photo/?fbid=1&set=a.2")?.url, undefined);
});

test("groups, pages and people links keep their shape", () => {
  assert.deepEqual(target("https://www.facebook.com/groups/tuyendungit/posts/123"), { url: "https://www.facebook.com/groups/tuyendungit", handle: "groups/tuyendungit", kind: "group" });
  assert.equal(target("https://www.facebook.com/pages/Some-Page/123456789")?.url, "https://www.facebook.com/123456789");
  assert.equal(target("https://www.facebook.com/people/Bui-Phu/100000020535380/")?.kind, "people");
  assert.equal(target("https://fb.me/abc123")?.kind, "link");
  assert.equal(target("https://www.facebook.com/share/p/abc/?mibextid=1")?.url, "https://www.facebook.com/share/p/abc/");
});

test("bare facebook paths round-trip through the shareable ?q= form", () => {
  for (const input of ["https://www.facebook.com/groups/tuyendungit/posts/1", "https://www.facebook.com/profile.php?id=100000020535380", "https://www.facebook.com/people/Bui-Phu/100000020535380/", "https://fb.me/abc", "bui.v.phu"]) {
    const first = target(input)!;
    const again = target(facebookShortQuery(first));
    assert.deepEqual(again, first, input);
  }
  assert.equal(facebookShortQuery(target("https://www.facebook.com/groups/tuyendungit")!), "groups/tuyendungit");
  assert.equal(target("groups/tuyendungit")?.kind, "group");
  assert.equal(target("profile.php?id=100000020535380")?.kind, "profile");
  assert.equal(target("/zuck")?.url, "https://www.facebook.com/zuck");
});

test("rejects non-facebook input", () => {
  assert.equal(target(""), null);
  assert.equal(target("https://www.tiktok.com/@katyperry"), null);
  assert.equal(target("https://www.facebook.com/"), null);
  assert.equal(target("https://www.facebook.com/watch/?v=1"), null);
  assert.equal(target("a"), null);
  assert.equal(target("bad handle"), null);
});

test("entity type and permanent id link", () => {
  assert.equal(facebookEntityType("Profile"), "Profile");
  assert.equal(facebookEntityType("page"), "Page");
  assert.equal(facebookEntityType(null), "Unknown");
  assert.equal(facebookIdLink("1", "Profile"), "https://www.facebook.com/profile.php?id=1");
  assert.equal(facebookIdLink("1", "Group"), "https://www.facebook.com/groups/1");
  assert.equal(facebookIdLink("1", "Page"), "https://www.facebook.com/1");
});

test("facebook endpoint falls back to the tiktok provider host", () => {
  const derived = resolveLookupEndpoint(undefined, "https://lookup.example/api/v1/tiktok?api_key=x", "/api/v1/fb-module/find-id");
  assert.equal(derived?.href, "https://lookup.example/api/v1/fb-module/find-id");
  const explicit = resolveLookupEndpoint("https://other.example/fb?api_key=old", undefined, "/x");
  assert.equal(withLookupApiKey(explicit!, "k/1'").href, "https://other.example/fb?api_key=k%2F1");
  assert.equal(resolveLookupEndpoint(undefined, undefined, "/x"), null);
});

test("facebook route only trusts same-origin browser fetches", () => {
  assert.equal(lookupFromOwnFrontend(new Headers({ "sec-fetch-site": "same-origin" }), "https://gmmo.info"), true);
  assert.equal(lookupFromOwnFrontend(new Headers({ origin: "https://evil.example", "sec-fetch-site": "same-origin" }), "https://gmmo.info"), false);
});
