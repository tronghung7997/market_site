# Observability deployment guide

Application-side logging and metrics are implemented in `marketplace-svc`.
This document lists the **deployment-side** requirements that cannot be
completed by application code alone.

## Canonical log transport

- The service writes **structured JSON to stdout** (structlog).
- Required fields when present: `timestamp`, `level`, `event`, `service`,
  `request_id` / `job_id`, `route`, `status`, `duration_ms`.
- Channel map:
  - **T** technical access / dependency failures → stdout
  - **S** security auth outcomes → stdout (never raw credentials)
  - **A** business audit → `log_entries` (same transaction as mutation)
  - **I** incidents → `alerts` with fingerprint upsert
  - **P/G** provider/gateway call history → own sessions, short TTL

## Off-host shipping

1. Configure the platform log driver/agent (Docker logging driver, Fluent Bit,
   CloudWatch agent, Loki Promtail, etc.) to collect container stdout.
2. Retain searchable production logs for an agreed period (recommend ≥ 30 days
   for security review; longer if compliance requires).
3. Index at least: `event`, `level`, `request_id`, `job_id`, `route`, `status`.

## Metrics

- Scrape `GET /internal/metrics` with header `X-Internal-Key` from a private
  network only. Do **not** expose this path publicly.
- Metrics use route **templates** only (no raw IDs, emails, or request IDs).
- Suggested alerts:
  - sustained 5xx rate on `http_requests_total{status_class="5xx"}`
  - `scheduler_job_runs_total{outcome="failure"}` spikes
  - growth of critical active incidents (from admin/DB or a derived metric)

## Error reporting (optional)

- Set `SENTRY_DSN` to enable optional Sentry init.
- Request bodies and auth headers are stripped before send.
- Attach `request_id` from structlog context when triaging.

## Health and readiness

- Liveness: `GET /health` (process up).
- Add a deployment-level readiness check that also probes DB connectivity if
  the orchestrator supports a separate probe path.
- Configure an uptime synthetic for `/health` from outside the cluster.

## Paging / on-call

Page on:

- sustained 5xx rate
- scheduler job failure bursts
- payment / deposit anomaly critical incidents
- critical active incidents (`provider_down`, `dproxy_auth_error`, out-of-credit)

Verify in staging that a synthetic failure produces **one** real notification
to the on-call destination before go-live.

## Retention defaults (application)

| Data | Default |
|------|--------:|
| `gateway_call_logs` | 7 days |
| `provider_call_logs` | 30 days |
| `log_entries` | 180 days |
| resolved alerts | 90 days after `resolved_at` |
| active alerts | never purged by app |
| `usage_records` / money ledgers | never purged by app |

Tune via env: `GATEWAY_CALL_LOG_RETENTION_DAYS`,
`PROVIDER_CALL_LOG_RETENTION_DAYS`, `LOG_ENTRY_RETENTION_DAYS`,
`RESOLVED_ALERT_RETENTION_DAYS`.

## Release gates (from logging-monitoring-review)

Before production:

- [ ] Request IDs validated; every outcome including unhandled 500 emits access log
- [ ] Alert creation never commits caller transactions
- [ ] Incidents use atomic fingerprints
- [ ] Auth failures emit S telemetry (no durable DB write per failure)
- [ ] Privileged mutations create same-transaction A events
- [ ] Gateway history redacted and bounded
- [ ] Retention jobs running
- [ ] Stdout shipped off-host; unhandled exceptions page on-call
