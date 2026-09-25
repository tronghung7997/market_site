import assert from "node:assert/strict";
import test from "node:test";

import { REFRESH_REUSE_GRACE_MS, createRefreshCoalescer } from "../lib/bff-refresh-coalescer.ts";

type Outcome = { ok: boolean; token?: string };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

const succeeded = (outcome: Outcome) => outcome.ok;

test("parallel 401s with the same refresh cookie share one rotation", async () => {
  const coalesce = createRefreshCoalescer<Outcome>();
  const gate = deferred<Outcome>();
  let rotations = 0;
  const rotate = () => { rotations += 1; return gate.promise; };

  const calls = [1, 2, 3, 4].map(() => coalesce("refresh-a", rotate, succeeded));
  gate.resolve({ ok: true, token: "new-a" });

  const outcomes = await Promise.all(calls);
  assert.equal(rotations, 1);
  assert.deepEqual(outcomes, Array(4).fill({ ok: true, token: "new-a" }));
});

test("a late request still carrying the old cookie gets the same new tokens within the grace window", async () => {
  let clock = 1_000;
  const coalesce = createRefreshCoalescer<Outcome>({ now: () => clock });
  let rotations = 0;
  const rotate = async () => { rotations += 1; return { ok: true, token: `new-${rotations}` }; };

  assert.deepEqual(await coalesce("refresh-a", rotate, succeeded), { ok: true, token: "new-1" });
  clock += REFRESH_REUSE_GRACE_MS - 1;
  assert.deepEqual(await coalesce("refresh-a", rotate, succeeded), { ok: true, token: "new-1" });
  assert.equal(rotations, 1);

  clock += 2;
  assert.deepEqual(await coalesce("refresh-a", rotate, succeeded), { ok: true, token: "new-2" });
  assert.equal(rotations, 2);
});

test("a failed rotation is not replayed, so the next request retries for real", async () => {
  const coalesce = createRefreshCoalescer<Outcome>();
  const results: Outcome[] = [{ ok: false }, { ok: true, token: "new-a" }];
  let rotations = 0;
  const rotate = async () => results[rotations++];

  assert.deepEqual(await coalesce("refresh-a", rotate, succeeded), { ok: false });
  assert.deepEqual(await coalesce("refresh-a", rotate, succeeded), { ok: true, token: "new-a" });
  assert.equal(rotations, 2);
});

test("different refresh cookies never share a rotation", async () => {
  const coalesce = createRefreshCoalescer<Outcome>();
  const rotateA = async () => ({ ok: true, token: "new-a" });
  const rotateB = async () => ({ ok: true, token: "new-b" });

  const [a, b] = await Promise.all([
    coalesce("refresh-a", rotateA, succeeded),
    coalesce("refresh-b", rotateB, succeeded),
  ]);
  assert.deepEqual(a, { ok: true, token: "new-a" });
  assert.deepEqual(b, { ok: true, token: "new-b" });
});

test("a thrown rotation reaches every waiter and does not stick", async () => {
  const coalesce = createRefreshCoalescer<Outcome>();
  let rotations = 0;
  const failing = async (): Promise<Outcome> => { rotations += 1; throw new Error("network"); };

  const calls = [coalesce("refresh-a", failing, succeeded), coalesce("refresh-a", failing, succeeded)];
  for (const call of calls) await assert.rejects(call, /network/);
  assert.equal(rotations, 1);

  assert.deepEqual(await coalesce("refresh-a", async () => ({ ok: true, token: "new" }), succeeded), { ok: true, token: "new" });
});

test("remembered rotations are bounded", async () => {
  const coalesce = createRefreshCoalescer<Outcome>({ maxEntries: 2 });
  let rotations = 0;
  const rotate = async () => { rotations += 1; return { ok: true, token: `t${rotations}` }; };

  await coalesce("refresh-1", rotate, succeeded);
  await coalesce("refresh-2", rotate, succeeded);
  await coalesce("refresh-3", rotate, succeeded); // evicts refresh-1
  await coalesce("refresh-1", rotate, succeeded);
  assert.equal(rotations, 4);
});
