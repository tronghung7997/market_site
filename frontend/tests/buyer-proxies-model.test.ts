import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_FILTERS,
  UNTAGGED,
  bulkCounts,
  canRotate,
  connectionString,
  groupImportByTag,
  lineNoLabel,
  lineOrderCode,
  lineState,
  locationLabel,
  matchTagImport,
  parseProxyFilters,
  parseTagImport,
  proxyFiltersToQuery,
  proxyFiltersToSearch,
  proxyKindLabel,
  renderExport,
  rotateErrorOutcome,
  rotateSkipReason,
  runBulk,
  runningShare,
  whitelistSkipReason,
  type ProxyFilters,
  type ProxyLine,
} from "../features/buyer-proxies/model.ts";

const NOW = Date.parse("2026-09-23T12:00:00Z");
const DAY = 86_400_000;
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();
const parse = (qs: string) => parseProxyFilters(new URLSearchParams(qs));

function line(over: Partial<ProxyLine> = {}): ProxyLine {
  return {
    id: "ORD-LUAVGKHU#01", order_code: "ORD-LUAVGKHU", line_no: 1, product_title: "Proxy dân cư Việt Nam 7 ngày",
    variant_name: "Residential · Việt Nam · 7 ngày", ip_type: "residential", rotation: "rotating", protocol: "HTTP",
    network: "Việt Nam", country: "VN", host: "203.0.113.15", port: 20165, username: "u_5", password: "p,\"x",
    public_ip: "203.0.113.201", status: "allocated", created_at: iso(-DAY), expires_at: iso(6 * DAY),
    rotation_available: true, cooldown_seconds: 15, last_rotated_at: null, whitelist_supported: false, whitelist_ips: null,
    socks5_port: null, credentials_editable: false, replaceable: false, renew_mode: null, plan_days: 7,
    tag_ids: ["t1"], note: "",
    ...over,
  };
}

describe("buyer proxies URL state", () => {
  it("round-trips every filter under the API's own param names and drops defaults", () => {
    const f: ProxyFilters = {
      ...DEFAULT_FILTERS, tab: "soon", tags: ["t_a", UNTAGGED], ipTypes: ["residential", "mobile"], rotations: ["rotating_key"],
      expiry: "3d", search: "203.0", sort: "newest", page: 3, perPage: 100,
    };
    const qs = proxyFiltersToSearch(f);
    assert.equal(qs, "?status=soon&q=203.0&tags=t_a%2C__none__&ip_type=residential%2Cmobile&rotation=rotating_key&expires=3d&sort=newest&page=3&per_page=100");
    assert.deepEqual(parse(qs), f);
    assert.equal(proxyFiltersToSearch(DEFAULT_FILTERS), "");
  });

  it("ignores unknown values, de-duplicates lists and keeps the open line", () => {
    assert.deepEqual(
      parse("status=bogus&ip_type=nope,datacenter,datacenter&rotation=static,sticky&sort=zzz&page=0&per_page=7&expires=1y"),
      { ...DEFAULT_FILTERS, ipTypes: ["datacenter"], rotations: ["static"] },
    );
    const keep = new URLSearchParams("line=ORD-LUAVGKHU%2301&status=running");
    assert.equal(proxyFiltersToSearch(DEFAULT_FILTERS, keep), "?line=ORD-LUAVGKHU%2301");
  });

  it("maps filters onto the GET /me/proxies query with explicit sort and paging", () => {
    assert.deepEqual(proxyFiltersToQuery(DEFAULT_FILTERS), { sort: "expiry_asc", page: 1, per_page: 50 });
    assert.deepEqual(
      proxyFiltersToQuery({ ...DEFAULT_FILTERS, tab: "problem", search: "  ORD-LUAVGKHU ", tags: [UNTAGGED], ipTypes: ["mobile"], rotations: ["static", "rotating"], expiry: "expired" }),
      { sort: "expiry_asc", page: 1, per_page: 50, status: "problem", q: "ORD-LUAVGKHU", tags: [UNTAGGED], ip_type: ["mobile"], rotation: ["static", "rotating"], expires: "expired" },
    );
  });

  it("reads the order code out of a public line id only", () => {
    assert.equal(lineOrderCode("ORD-LUAVGKHU#01"), "ORD-LUAVGKHU");
    assert.equal(lineOrderCode("42"), null);
    assert.equal(lineOrderCode(null), null);
  });
});

describe("buyer proxies display", () => {
  it("composes the kind label from ip_type × rotation", () => {
    assert.equal(proxyKindLabel({ ip_type: "residential", rotation: "rotating" }), "residential_rotating");
    assert.equal(proxyKindLabel({ ip_type: "residential", rotation: "static" }), "residential_static");
    assert.equal(proxyKindLabel({ ip_type: "mobile", rotation: "rotating" }), "mobile");
    assert.equal(proxyKindLabel({ ip_type: "datacenter", rotation: "static" }), "datacenter");
    assert.equal(proxyKindLabel({ ip_type: "residential", rotation: "rotating_key" }), "rotating_key");
    assert.equal(proxyKindLabel({ ip_type: "mobile", rotation: "rotating_key" }), "rotating_key");
  });

  it("labels lines and locations without row ids or duplicated parts", () => {
    assert.equal(lineNoLabel({ line_no: 1 }), "#01");
    assert.equal(locationLabel({ network: "Viettel", country: "VN" }), "Viettel · VN");
    assert.equal(locationLabel({ network: "vn", country: "VN" }), "vn");
    assert.equal(locationLabel({ network: "Việt Nam", country: null }), "Việt Nam");
  });

  it("folds backend status with the expiry clock", () => {
    assert.equal(lineState(line(), NOW), "running");
    assert.equal(lineState(line({ expires_at: iso(2 * DAY) }), NOW), "soon");
    assert.equal(lineState(line({ expires_at: iso(-1) }), NOW), "expired");
    assert.equal(lineState(line({ status: "released" }), NOW), "expired");
    assert.equal(lineState(line({ status: "offline" }), NOW), "offline");
    assert.equal(lineState(line({ status: "error" }), NOW), "error");
    assert.equal(runningShare({ all: 8, running: 6, soon: 1, problem: 2 }), 75);
    assert.equal(runningShare({ all: 0, running: 0, soon: 0, problem: 0 }), 0);
  });
});

describe("buyer proxies bulk actions", () => {
  it("skips lines that cannot rotate before sending anything", () => {
    assert.equal(rotateSkipReason(line(), NOW), null);
    assert.equal(rotateSkipReason(line({ rotation_available: false }), NOW), "unsupported");
    assert.equal(rotateSkipReason(line({ expires_at: iso(-DAY) }), NOW), "expired");
    assert.equal(rotateSkipReason(line({ status: "error" }), NOW), "failed");
    assert.equal(rotateSkipReason(line({ last_rotated_at: iso(-5_000) }), NOW), "cooldown");
    assert.equal(rotateSkipReason(line({ last_rotated_at: iso(-20_000) }), NOW), null);
    assert.equal(canRotate(line({ status: "error" }), NOW), false);
    assert.equal(whitelistSkipReason(line()), "unsupported");
    assert.equal(whitelistSkipReason(line({ whitelist_supported: true })), null);
  });

  it("treats a 429 as cooldown and anything else as a failure", () => {
    assert.equal(rotateErrorOutcome({ status: 429 }), "cooldown");
    assert.equal(rotateErrorOutcome({ status: 502 }), "failed");
    assert.equal(rotateErrorOutcome(new Error("offline")), "failed");
  });

  it("aggregates outcomes in input order with bounded concurrency", async () => {
    const items = ["a", "b", "c", "d", "e"].map((id) => ({ id }));
    let inFlight = 0;
    let peak = 0;
    const progress: number[] = [];
    const result = await runBulk(items, async ({ id }) => {
      inFlight += 1; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, id === "b" ? 5 : 1));
      inFlight -= 1;
      if (id === "c") throw Object.assign(new Error("rate"), { status: 429 });
      if (id === "d") return rotateErrorOutcome({ status: 429 });
      return "ok";
    }, { precheck: ({ id }) => (id === "e" ? "unsupported" : null), concurrency: 2, onProgress: (n) => progress.push(n) });

    assert.deepEqual(result.ok, ["a", "b"]);
    assert.deepEqual(result.skipped, [{ id: "c", reason: "failed" }, { id: "d", reason: "cooldown" }, { id: "e", reason: "unsupported" }]);
    assert.ok(peak <= 2);
    assert.deepEqual(progress, [1, 2, 3, 4, 5]);
    assert.deepEqual(bulkCounts(result), { ok: 2, skipped: 3, cooldown: 1, unsupported: 1, expired: 0, failed: 1 });
    assert.deepEqual(await runBulk([], async () => "ok"), { ok: [], skipped: [] });
  });
});

describe("buyer proxies export and tags", () => {
  const key = line({ id: "ORD-LUAVGKHU#02", line_no: 2, rotation: "rotating_key", username: null, password: null, port: 21001, socks5_port: 31001, country: null });

  it("renders every export format", () => {
    const name = (id: string) => (id === "t1" ? "Farm" : id);
    assert.equal(connectionString(line()), "203.0.113.15:20165:u_5:p,\"x");
    assert.equal(connectionString(key), "203.0.113.15:21001");
    assert.equal(renderExport([line(), key], "user_pass_at_host", name), "u_5:p,\"x@203.0.113.15:20165\n203.0.113.15:21001");
    assert.equal(renderExport([line(), key], "host_port", name), "203.0.113.15:20165\n203.0.113.15:21001");
    const csv = renderExport([line()], "csv", name).split("\n");
    assert.equal(csv[0], "line,host,port,socks5_port,username,password,protocol,ip_type,rotation,network,country,expires_at,tags,note");
    assert.ok(csv[1].includes('"p,""x"'), "csv escapes quotes and commas");
    const json = JSON.parse(renderExport([key], "json", name));
    assert.equal(json[0].socks5_port, 31001);
    assert.equal(json[0].rotation, "rotating_key");
    assert.equal(json[0].country, null);
    assert.equal(JSON.parse(renderExport([line()], "json", name))[0].tags[0], "Farm");
    for (const format of ["csv", "json"] as const) {
      assert.ok(!/provider|adapter|source/i.test(renderExport([line()], format, name)), "exports never name a source");
    }
  });

  it("parses, matches and groups tag imports", () => {
    const rows = parseTagImport("# comment\n203.0.113.15:20165,Farm|Team A\n203.0.113.15:21001:u:p, farm \n9.9.9.9:1,Ghost\nbroken line\n");
    assert.deepEqual(rows, [
      { key: "203.0.113.15:20165", tags: ["Farm", "Team A"] },
      { key: "203.0.113.15:21001", tags: ["farm"] },
      { key: "9.9.9.9:1", tags: ["Ghost"] },
    ]);
    const { perLine, unknown } = matchTagImport(rows, [line(), key]);
    assert.equal(unknown, 1);
    assert.deepEqual([...perLine.keys()], ["ORD-LUAVGKHU#01", "ORD-LUAVGKHU#02"]);
    assert.deepEqual(groupImportByTag(perLine), [
      { name: "Farm", lineIds: ["ORD-LUAVGKHU#01", "ORD-LUAVGKHU#02"] },
      { name: "Team A", lineIds: ["ORD-LUAVGKHU#01"] },
    ]);
  });
});
