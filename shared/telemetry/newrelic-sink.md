---
id: newrelic-sink
name: NewRelic Telemetry Sink
version: 0.1.0
status: poc
kind: integration
layer: platform
category: telemetry
description: The pluggable NewRelic telemetry sink — OFF by default, config-gated in .eq-sparks.yml. How agent/skill JSONL events forward to NewRelic (Event API / Log API), the config + credential discipline (ENV/secret store, never committed — cross-links safety-rails G4), the event→metric mapping, the @infra dashboards, and a provisioning checklist. Until provisioned, the local JSONL sink keeps everything running.
applies_to: "@infra"
related: safety-rails, budget-policy, cache-policy, memory-schema
---

# NewRelic Telemetry Sink

> Integration note — **not** a skill, and **not** a runtime dependency. This file documents how the
> **pluggable NewRelic sink** is wired, gated, and authenticated for the eq-sparks telemetry pipeline.
> It is **read-infra for [`@infra`](../../agents/platform/infra.md)** — the only agent that reads a sink.
> NewRelic is **OFF by default**; nothing here ships enabled, and the platform functions fully
> **today** on the local JSONL sink with zero provisioning. Read this once when a workspace is ready
> to forward telemetry to NewRelic; agents never wire it themselves.

---

## Where this sits

eq-sparks agents and skills emit **one JSONL event per action** — the telemetry stream. There are two
possible **sinks** for that stream, selected by `.eq-sparks.yml`:

| Sink | Path / target | Status | When authoritative |
|---|---|---|---|
| **`local`** (default) | `.eq-sparks/telemetry/<run-id>.jsonl` (gitignored, per-run) | Works today, no provisioning | Always, unless NewRelic is explicitly enabled |
| **`newrelic`** (pluggable) | NewRelic Event API + Log API (this doc) | OFF by default | Only when `telemetry.sink: newrelic` **AND** `newrelic.enabled: true` **AND** credentials present in ENV/secret store |

[`@infra`](../../agents/platform/infra.md) reads **whichever sink is active** and rolls run telemetry
into a cost / health / readiness picture for [`@supervisor`](../../agents/governance/supervisor.md) and the
console. The local sink is the **authoritative default**; NewRelic is an additive forwarding target that
changes *where* `@infra` reads from — it never changes *what* gets emitted, and it never blocks a run.

> The OS internals (cache, budget ledger, run memory, telemetry) stay behind `.eq-sparks/` and out of
> version control. This sink config is the rare exception: the *switch* lives in the committed
> `.eq-sparks.yml`, but the *credentials* never do (see [Credentials](#credentials--g4)).

---

## How forwarding works

When the NewRelic sink is active, each JSONL event the run emits is **mirrored** to NewRelic in
addition to being written to the local file. The local `.eq-sparks/telemetry/<run-id>.jsonl` is always
written — NewRelic is a forward, never a replacement, so a NewRelic outage can never lose the run's
telemetry or block it (see [Until then](#until-then--the-local-sink-keeps-everything-running)).

Forwarding uses two NewRelic ingest APIs, chosen by event shape:

- **Event API** — structured run events become **NewRelic custom events** (one custom event type per
  category; see the [mapping](#what-it-maps)). Used for discrete, queryable actions: agent start/stop,
  skill calls, `@critic` PASS/FAIL, escalations, gate verdicts, cache hits, downstream outcomes.
- **Log API** — free-form or large-payload lines (e.g. a verbose investigation note) become **NewRelic
  log records**, decorated with the same correlation attributes so they join against the custom events.

Both ingests carry the run correlation keys (`run_id`, `seq`, `agent`, `stage`) so a single run threads
cleanly across events, metrics, and logs in one NewRelic account. Forwarding is **fire-and-forget with a
local fallback**: the local JSONL write is the durable record; the NewRelic send is best-effort. A failed
send is logged locally and surfaced by `@infra` as `BLOCKED:sink-misconfigured` / `sink-unreadable` — it
does **not** fail the agent action.

> **No new runtime dependency.** Forwarding is a thin HTTPS POST to the NewRelic ingest endpoints from the
> telemetry-writer that already exists in `.eq-sparks/` — it adds **no** entry to any `package.json`
> `dependencies` or `.csproj` `PackageReference` (`no-runtime-deps`, [`safety-rails`](../guardrails/safety-rails.md)).

---

## Configuration (`.eq-sparks.yml`)

The sink is selected by a `telemetry:` block in the consumer repo's `.eq-sparks.yml` (see
[`.eq-sparks.yml.example`](../../.eq-sparks.yml.example)). The block below is the **complete** shape;
the defaults keep NewRelic OFF, so omitting the block entirely means `local`.

```yaml
# ---------------------------------------------------------------------------
# Telemetry sink — see shared/telemetry/newrelic-sink.md. Agents emit one JSONL
# event per action. DEFAULT sink is the local per-run file and works with zero
# provisioning. NewRelic is pluggable and OFF until explicitly enabled AND
# credentialed. The local file is always written regardless of sink.
# ---------------------------------------------------------------------------
telemetry:
  sink: local                  # local | newrelic   (default: local)

  newrelic:
    enabled: false             # MUST be true (and sink: newrelic) to forward.
                               # Default false — nothing forwards until flipped.
    region: US                 # US | EU  — selects the ingest endpoint region.
    # account_id + license_key are NEVER set here. They are read from ENV /
    # secret store at run time (see Credentials below). Putting either in this
    # file is a safety-rails G4 violation and a hard halt.
    custom_event_prefix: EqSparks   # prefix for NewRelic custom event types
```

**Activation is a three-part AND** — every condition must hold or `@infra` reads the local sink and flags
the gap (it never silently runs without telemetry):

1. `telemetry.sink: newrelic`
2. `telemetry.newrelic.enabled: true`
3. Credentials (`account_id` + `license_key`) present in ENV / secret store.

If `sink: newrelic` but `enabled: false` or credentials are absent, `@infra` reports
`BLOCKED:sink-misconfigured`, **falls back to the local JSONL sink**, and surfaces the misconfiguration.
It never reads a committed secret and never fabricates numbers.

---

## Credentials — G4

NewRelic ingest needs two values: a **NewRelic `account_id`** and an **ingest `license_key`** (an Insert
/ License key with `Event API` + `Log API` ingest scope). **Neither is ever committed.** This cross-links
the hard prohibition [`no-secrets` / **G4**](../guardrails/safety-rails.md#hard-prohibitions-hard-fail---blockedsafety-rail)
("Never commit hardcoded secrets") in [`safety-rails`](../guardrails/safety-rails.md), enforced by the
pre-commit secret-scan hook and by `@scanner`'s secret-pattern checks (G6 backstop).

| Value | Where it lives | Where it must NEVER live |
|---|---|---|
| NewRelic `account_id` | ENV var (e.g. `NEW_RELIC_ACCOUNT_ID`) or the workspace secret store | `.eq-sparks.yml`, `.env` committed to git, source, fixtures, mcp.json |
| Ingest `license_key` | ENV var (e.g. `NEW_RELIC_LICENSE_KEY`) or the workspace secret store | anywhere in version control, any log line, any handoff envelope |

Rules (all inherited from `safety-rails`):

- The credentials are resolved from the environment / secret store **at run time only**. A secret-pattern
  match reaching disk in a committed file is an immediate halt → `BLOCKED:safety-rail` (`no-secrets`).
- `@infra` **confirms the credentials are *present*** to decide the active sink — it **never reads, echoes,
  or logs the value**. The `account_id` and `license_key` are masked/omitted from every report, console
  line, and handoff envelope.
- The license key is the **ingest** key only (write-only forwarding scope). Do not use a User key or any
  key with broader account access. Rotate via the secret store, never by editing a repo.

---

## What it maps

The same JSONL event stream the local sink records is what forwards. The event schema is the telemetry
contract emitted alongside the per-run memory under `.eq-sparks/` (see [`memory-schema`](../memory/memory-schema.md)
and [`budget-policy`](../guardrails/budget-policy.md)). Mapping by destination:

### Events → NewRelic custom events (Event API)

Each event category becomes a custom event type, prefixed per `custom_event_prefix` (default `EqSparks`).
One JSONL line → one custom event, carrying the correlation keys plus its category attributes:

| JSONL event (category) | NewRelic custom event type | Key attributes carried |
|---|---|---|
| agent action start/stop | `EqSparksAgentRun` | `run_id`, `agent`, `stage`, `model_tier`, `outcome`, `duration_ms` |
| skill invocation | `EqSparksSkillCall` | `run_id`, `agent`, `skill_id`, `cache_hit`, `duration_ms` |
| `@critic` gate verdict | `EqSparksGate` | `run_id`, `stage`, `verdict` (PASS/FAIL), `rail_id` (if blocked) |
| model escalation | `EqSparksEscalation` | `run_id`, `agent`, `from_tier`, `to_tier`, `trigger` |
| deploy/quality gate (G7/G13) | `EqSparksReadiness` | `run_id`, `gate` (G7/G13), `verdict` (GO/NO-GO), `signoff_count` |
| downstream call outcome | `EqSparksDownstream` | `run_id`, `agent`, `status`, `latency_ms`, `error_class` |

Correlation keys (`run_id`, `seq`, `agent`, `stage`) are attached to **every** custom event so `@infra`'s
NRQL queries thread a run end-to-end. No payload field may contain a secret or PII (`safety-rails` G4/G5).

### Cost / budget → NewRelic metrics

The budget meter that `budget-check` tallies (see [`budget-policy`](../guardrails/budget-policy.md)) forwards
as **NewRelic metrics**, so cost/burn is trend-able and alert-able across runs rather than read per-file:

| Budget signal (`budget-check`) | NewRelic metric | Unit |
|---|---|---|
| tool calls used vs `tool_budget` (60) | `eqsparks.budget.tool_calls` | count |
| tokens used (per tier) | `eqsparks.budget.tokens` | count |
| USD spend vs `cost_cap_usd` (2.00) | `eqsparks.budget.cost_usd` | USD |
| escalation cost (rung jumps) | `eqsparks.budget.escalations` | count |

`@infra` still treats `budget-check` as the **authoritative meter** — the metrics mirror it for dashboards
and alerts; they do not replace the in-run ledger that enforces the ceiling.

### @infra dashboards

With the sink enabled, `@infra` reads NewRelic (instead of the local JSONL) and surfaces the same rollup it
produces today, now backed by queryable history:

- **Run health** — error rate, timeout rate, downstream failure rate, escalation churn (from the custom
  events above).
- **Cost / budget burn** — tool calls / tokens / USD vs ceiling, per-stage attribution (from the metrics).
- **Deploy readiness** — `EqSparksReadiness` for **G7** (quality gates green) and **G13** (≥ 2 PROD
  sign-offs), surfaced as the GO / NO-GO verdict `@infra` reports (it reports; the pipeline enforces).

The dashboards are a **read surface for `@infra` and humans** — `@infra` stays read-only and report-only;
no dashboard, alert, or NewRelic write is created by an agent.

---

## Provisioning checklist (do later)

Off by default and intentionally deferred. When a workspace is ready to forward telemetry to NewRelic:

1. **Create/obtain a NewRelic account** and note the **`account_id`**.
2. **Mint an ingest license key** scoped to **Event API + Log API** write only (not a User key).
3. **Store credentials in the secret store / ENV** — `NEW_RELIC_ACCOUNT_ID` and `NEW_RELIC_LICENSE_KEY`.
   **Never** put either in `.eq-sparks.yml`, `.env`-in-git, source, or any committed file (G4).
4. **Pick the region** (`US` | `EU`) so the correct ingest endpoint is used.
5. **Flip the config** in `.eq-sparks.yml`: set `telemetry.sink: newrelic` and
   `telemetry.newrelic.enabled: true` (optionally set `custom_event_prefix`).
6. **Verify the three-part AND** — sink, enabled, and credentials all present — then run a smoke run and
   confirm `@infra` reports `sink_used: newrelic` and that events/metrics land in NewRelic.
7. **Build the `@infra` dashboards** from the custom events + metrics above (run health, cost burn, deploy
   readiness). Add alerts on budget burn and error/timeout spikes as desired.
8. **Confirm masking** — verify no `account_id`, `license_key`, secret, or PII appears in any forwarded
   event, log record, or handoff envelope (`safety-rails` G4/G5).

No step here adds a runtime dependency or edits build/CI config — provisioning is account setup + a config
flip + dashboard authoring only.

---

## Until then — the local sink keeps everything running

Until NewRelic is provisioned (and the three-part AND is satisfied), the **local
`.eq-sparks/telemetry/<run-id>.jsonl` sink is authoritative** and **nothing blocks**:

- Agents and skills emit the identical JSONL event stream regardless of sink — the local file is always
  written.
- `@infra` reads the local JSONL and produces the full cost / health / G7+G13 readiness rollup with zero
  provisioning.
- If `sink: newrelic` is set but `enabled` is false or credentials are absent, `@infra` falls back to the
  local sink and reports `BLOCKED:sink-misconfigured` for the human — it never runs blind and never reads a
  committed secret.

The NewRelic sink is purely additive: enabling it changes *where* `@infra` reads and gives queryable
cross-run history; it changes nothing about *what* is emitted, and it can never be a single point of failure
for a run.
