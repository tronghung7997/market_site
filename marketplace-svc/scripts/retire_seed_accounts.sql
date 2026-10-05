-- Retire test/seed accounts without breaking the ledger.
-- SQL twin of marketplace-svc/src/ops/retire_seed.py (scripts/purge_seed_accounts.py), for running in pgAdmin.
--
-- Run AFTER the release that knows the `seed-writeoff:` reference is deployed
-- (otherwise the period report shows the write-off as income), and AFTER every
-- supplier source owned by a seed account has been moved to a real shop.
--
-- Everything is one transaction: any guard below raises and nothing is kept.
-- Afterwards: Admin › Tài chính › Báo cáo › "Chạy ngay" must show 0 findings.

BEGIN;

-- Accounts whose available balance is written off / accounts retired as seed.
CREATE TEMP TABLE _zero(account_id int PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE _seed(account_id int PRIMARY KEY) ON COMMIT DROP;
INSERT INTO _zero VALUES (1), (2), (3), (4), (7), (8), (13);
-- #2 still owns supplier sources 9/10/11: leave it out until they are moved,
-- then run the follow-up block at the end of this file.
INSERT INTO _seed VALUES (1), (3), (4), (7);

DO $$
DECLARE actor int := 18;   -- admin recorded in the audit log
BEGIN
  -- Guard: a seed account still owns a supplier source → its products would be suspended.
  IF EXISTS (SELECT 1 FROM providers p JOIN _seed s ON s.account_id = p.seller_id) THEN
    RAISE EXCEPTION 'Seed account still owns a supplier source: move it first (Nguồn hàng › Cài đặt › Đổi cửa hàng)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = actor AND 'admin' = ANY(roles)) THEN
    RAISE EXCEPTION 'actor % is not an admin', actor;
  END IF;
END $$;

-- 1. Write off balances: one adjustment_debit per wallet, under row lock.
CREATE TEMP TABLE _debit ON COMMIT DROP AS
SELECT w.id AS wallet_id, w.account_id, w.available_balance AS amount
FROM wallets w JOIN _zero z ON z.account_id = w.account_id
WHERE w.available_balance > 0
FOR UPDATE OF w;

INSERT INTO transactions (wallet_id, type, amount, description, reference_id, created_at)
SELECT wallet_id, 'adjustment_debit', amount, 'GMMO trừ tiền — huỷ tiền tài khoản test/seed',
       'seed-writeoff:account-' || account_id, now()
FROM _debit;

UPDATE wallets w SET available_balance = w.available_balance - d.amount, updated_at = now()
FROM _debit d WHERE d.wallet_id = w.id;

INSERT INTO log_entries (service, level, message, metadata, created_at)
SELECT 'marketplace-svc', 'warning',
       'Admin debit ' || replace(to_char(amount, 'FM999,999,999,999'), ',', '.') || 'đ from account ' || account_id,
       json_build_object('event', 'manual_debit', 'actor_id', 18, 'actor_type', 'admin', 'subject_type', 'account',
                         'subject_id', account_id, 'outcome', 'success', 'source', 'sql:retire-seed-accounts',
                         'amount', amount, 'reason', 'huỷ tiền tài khoản test/seed'),
       now()
FROM _debit;

-- 2. Seed accounts: flag them, suspend their products.
UPDATE accounts SET is_seeded = true WHERE id IN (SELECT account_id FROM _seed) AND is_seeded = false;

CREATE TEMP TABLE _suspended ON COMMIT DROP AS
WITH s AS (
  UPDATE products SET status = 'suspended'
  WHERE seller_id IN (SELECT account_id FROM _seed) AND status <> 'suspended'
  RETURNING id
) SELECT id FROM s;

INSERT INTO log_entries (service, level, message, metadata, created_at)
SELECT 'marketplace-svc', 'warning', 'Accounts retired as seed data',
       json_build_object('event', 'seed_accounts_retired', 'actor_id', 18, 'actor_type', 'admin',
                         'account_ids', (SELECT json_agg(account_id ORDER BY account_id) FROM _seed),
                         'product_ids_suspended', (SELECT coalesce(json_agg(id ORDER BY id), '[]'::json) FROM _suspended),
                         'source', 'sql:retire-seed-accounts'),
       now();

-- 3. Hide reviews of seeded orders (and seeded reviews), recompute ratings.
CREATE TEMP TABLE _rated ON COMMIT DROP AS
WITH h AS (
  UPDATE reviews r SET is_hidden = true, hidden_reason = 'Dữ liệu test/seed', hidden_by_id = 18, hidden_at = now()
  WHERE r.is_hidden = false
    AND (r.is_seeded OR r.order_id IN (SELECT id FROM orders WHERE is_seeded))
  RETURNING r.product_id
) SELECT DISTINCT product_id FROM h;

UPDATE products p SET rating_avg = s.avg, rating_count = s.n
FROM (
  SELECT x.product_id, avg(r.rating)::float AS avg, count(r.id)::int AS n
  FROM _rated x LEFT JOIN reviews r ON r.product_id = x.product_id AND r.is_hidden = false
  GROUP BY x.product_id
) s WHERE p.id = s.product_id;

-- 4. Sold figures from real (non-seeded) completed orders only.
UPDATE products p SET sold_count = COALESCE(s.units, 0)
FROM products p2
LEFT JOIN (
  SELECT COALESCE(o.product_id, v.product_id) AS product_id,
         SUM(CASE WHEN o.variant_id IS NOT NULL THEN GREATEST(o.quantity, 1) ELSE 1 END) AS units
  FROM orders o LEFT JOIN product_variants v ON v.id = o.variant_id
  WHERE o.status = 'completed' AND o.is_seeded IS NOT TRUE
  GROUP BY COALESCE(o.product_id, v.product_id)
) s ON s.product_id = p2.id
WHERE p.id = p2.id AND p.sold_count IS DISTINCT FROM COALESCE(s.units, 0);

-- Guard: every written-off wallet is at 0 and was debited exactly its balance.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM wallets w JOIN _zero z ON z.account_id = w.account_id WHERE w.available_balance <> 0) THEN
    RAISE EXCEPTION 'a written-off wallet is not at 0';
  END IF;
END $$;

-- Summary (review it, then COMMIT — or ROLLBACK to undo everything).
SELECT 'debit' AS what, account_id::text AS ref, amount FROM _debit
UNION ALL SELECT 'products_suspended', (SELECT count(*) FROM _suspended)::text, NULL
UNION ALL SELECT 'products_rerated', (SELECT count(*) FROM _rated)::text, NULL
ORDER BY 1, 2;

-- COMMIT;

-- ── Follow-up, once sources 9/10/11 are moved off account #2 ─────────────────
-- BEGIN;
-- DO $$ BEGIN
--   IF EXISTS (SELECT 1 FROM providers WHERE seller_id = 2) THEN
--     RAISE EXCEPTION 'account #2 still owns a supplier source';
--   END IF;
-- END $$;
-- UPDATE accounts SET is_seeded = true WHERE id = 2;
-- UPDATE products SET status = 'suspended' WHERE seller_id = 2 AND status <> 'suspended' RETURNING id;
-- COMMIT;
