# Monitoring & Alerting Documentation — Premnathrail Portal

> Defines what is monitored and how alerts work. Companion to [RUNBOOK.md](RUNBOOK.md) and [INCIDENT_RUNBOOK.md](../maintenance/INCIDENT_RUNBOOK.md).

## Current State (as found)

No dedicated monitoring/alerting infrastructure (Datadog, CloudWatch, Grafana, etc.) was found configured in this repo. What exists today is **application-level logging only**:

| Signal | Where It's Logged | Alerting? |
|---|---|---|
| Every request outcome | `OWASPMiddleware` — `Request-ID`, method, path, status, duration (`SECURITY.md` §A09) | ❌ No — log only |
| Security rejections | Tagged log lines (`[A01]`, `[A03]`, `[A07]`, etc.) | ❌ No — log only |
| Slow requests (>5s) | Logged as warning (`SLOW_REQUEST_MS`) | ❌ No — log only, no threshold-based alert |
| IP bans (rate-limit violations) | Logged when a ban is triggered | ❌ No — log only |
| Auth events (login/logout/failures) | Logged per `SECURITY.md` "Logs to collect" | ❌ No — log only |

`SECURITY.md` §Logging & Monitoring explicitly recommends "Use ELK stack, CloudWatch, or Datadog" and "Alert on suspicious patterns" as aspirational guidance — **not implemented**.

## Gap

There is currently no automated way to know, in real time, that:
- The API is down or erroring at an elevated rate
- The database connection pool is exhausted
- A specific IP is actively being auto-banned (someone would have to grep logs)
- Disk/memory on the host is approaching limits

## Recommended Minimum Viable Setup (Not Yet Built)

1. **Uptime check** — external ping to `/health` every 1-5 min, alert on 2+ consecutive failures
2. **Error rate alert** — 5xx rate over a rolling window (the `Request-ID`-tagged logs already have everything needed; just needs a log aggregator + alert rule)
3. **Slow-request alert** — promote the existing `SLOW_REQUEST_MS` log line to a real alert instead of log-only
4. **DB connection pool** — expose pool utilization as a metric if the hosting platform supports it
5. **Security event alert** — real-time alert on IP auto-ban events (currently just a log line)

## Ownership

⚠️ Unassigned — no on-call/ops contact list was found in this repo (`SECURITY.md` §Incident Response has placeholder `[email]` fields for Security lead/CTO/Legal, unfilled).

## Relation to Other Docs

- Once real monitoring exists, wire it into [INCIDENT_RUNBOOK.md](../maintenance/INCIDENT_RUNBOOK.md)'s detection step
- Cross-reference [Risk Register R-06](../product/RISK_REGISTER.md) (performance-at-scale risk) — better monitoring is the mitigation path for that risk

---
*Last updated: 2026-08-27. Update once real monitoring tooling is chosen and configured — this document currently describes a gap, not a working system.*
