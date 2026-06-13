# Telemetry Sinks

> Architecture note — **not** a skill. This file documents the **pluggable sink
> architecture** for eq-sparks telemetry: where the per-action events that agents
> and skills emit actually land, how the active sink is selected, and why adding
> a new sink (NewRelic) later is a config flip rather than an agent change. The
> NewRelic-specific wiring lives in [`newrelic-sink.md`](./newrelic-sink.md). The
> agent that *reads* the active sink is [`@infra`](../../agents/platform/infra.md).

---

## The one-line contract

Every agent and skill emits **one JSONL event per action** (the telemetry schema)
to the **active sink**. The active sink is chosen by `telemetry.sink` in
`.eq-sparks.yml`. The **DEFAULT, authoritative sink is the local JSONL file** at
`.eq-sparks/telemetry/<run-id>.jsonl` — it is always on, needs no provisioning,
and **works today**. The pluggable alternative is **NewRelic**, which is **OFF
until provisioned**. Until NewRelic is provisioned the local sink is
**authoritative and NOTHING blocks** — the platform is fully functional with the
default sink alone.

---

## 1. The two sinks

| Sink | `telemetry.sink` | Status | Location / target | Provisioning |
|---|---|---|---|---|
| **Local JSONL** (default) | `local` | **Always on, works today** | `.eq-sparks/telemetry/<run-id>.jsonl` | None — created at run start |
| **NewRelic** (pluggable) | `newrelic` | **OFF by default** | NewRelic Logs/Events API | Requires `newrelic.enabled: true` + `account_id` + `license` (see [`newrelic-sink.md`](./newrelic-sink.md)) |

### Local JSONL — the default, authoritative sink

- One file per run: `.eq-sparks/telemetry/<run-id>.jsonl`, where `<run-id>` is the
  same id used across the per-run memory directory `.eq-sparks/agent-memory/<run-id>/`
  (see [`memory-schema`](../memory/memory-schema.md)).
- **Append-only.** Each agent/skill action appends exactly one JSON object per line —
  the telemetry schema event. No event is ever rewritten or deleted in place.
- **Gitignored.** `.eq-sparks/` is gitignored in consumer repos and synced from this
  monorepo; writing telemetry anywhere outside `.eq-sparks/telemetry/` is a
  [`path-policy`](../guardrails/path-policy.md) violation.
- **No provisioning, no secrets, no network.** The file is created at run start and is
  the unit `@infra` reads. This is why the platform observes itself **today**, before
  any external observability backend exists.

### NewRelic — the pluggable sink

- Selected only when `telemetry.sink: newrelic` **AND** `newrelic.enabled: true` in
  `.eq-sparks.yml`. Either condition false ⇒ the local sink stays authoritative.
- `account_id` + `license` are supplied via **ENV / secret store, NEVER committed**
  (`safety-rails`). The config file names *that* a NewRelic sink exists; it never holds
  the credential value.
- Full wiring — event mapping, attributes, batching, failure handling — is documented in
  [`newrelic-sink.md`](./newrelic-sink.md). This file is sink-agnostic on purpose and
  defers the provider detail there.

---

## 2. How events flow

```
  agent / skill action
          │
          │  emit 1 JSONL event  (telemetry schema)
          ▼
   ┌──────────────┐      telemetry.sink ?
   │ active sink  │◄──── local  → .eq-sparks/telemetry/<run-id>.jsonl   (default, today)
   └──────┬───────┘      newrelic→ NewRelic API  (only if newrelic.enabled: true)
          │
          ▼
       @infra  reads whichever sink is active → cost / health / readiness rollup
          │
          ├─► @supervisor   (stage go/no-go, run Summary)
          ├─► console-render (Stage block + Summary)
          └─► @learner       (accrued cross-run history → proposed lessons, G14 / PR-gated)
```

- **Emitters** — agents and skills. Each action (a tool call, a skill invocation, a
  cache hit/miss, an escalation, a downstream call, a gate verdict) emits one event.
  Cache hit/miss events feed [`budget-check`](../guardrails/budget-policy.md) and the
  console exactly as described in [`cache-policy`](../memory/cache-policy.md) §7.
- **The sink** — the single write target for those events, resolved from config.
  Emitters do not know or care *which* sink is active; they emit to "the sink."
- **The reader** — [`@infra`](../../agents/platform/infra.md) reads whichever sink is
  active and turns raw events into a cost / health / G7+G13 readiness rollup, surfaced to
  `@supervisor` and the console. `@infra` is **read-only and report-only** — it never
  deploys and never writes telemetry.
- **The curator** — [`@learner`](../../agents/platform/learner.md) reads the *accrued*
  telemetry across runs (plus handoff envelopes / self-eval) to **propose** durable
  lessons. It proposes only; humans merge via PR (**G14**).

---

## 3. Sink-agnostic by design — why NewRelic is a config flip

The architecture deliberately keeps emitters and the reader **decoupled from the sink
implementation**:

- **Emitters write to "the active sink," not to a named backend.** The same event-emit
  call lands in local JSONL today and would land in NewRelic the moment the config flips —
  the emitting agent/skill code does not change.
- **The reader resolves the sink from `.eq-sparks.yml`.** `@infra` reads whichever sink is
  active; its operational sequence already branches on `telemetry.sink` /
  `newrelic.enabled` (see [`@infra`](../../agents/platform/infra.md)).
- **The event shape is one schema across both sinks.** Local JSONL stores the event as a
  line; NewRelic maps the same fields to its attributes (per [`newrelic-sink.md`](./newrelic-sink.md)).
  No second schema, no per-sink event vocabulary.

**Net effect:** turning NewRelic on is a **config flip** in `.eq-sparks.yml`
(`telemetry.sink: newrelic` + `newrelic.enabled: true`, credentials in ENV/secret store) —
**no agent changes, no skill changes, no orchestrator changes.** Adding a *future* third
sink follows the same pattern: implement the sink, register a `telemetry.sink` value, document
it as a sibling of `newrelic-sink.md` — emitters and `@infra` are untouched.

---

## 4. Config (`.eq-sparks.yml`)

The sink is selected by a `telemetry` block in `.eq-sparks.yml`. Conceptually:

```yaml
telemetry:
  sink: local            # local | newrelic   (default: local — authoritative today)
  newrelic:
    enabled: false       # OFF by default; true ONLY when provisioned
    # account_id + license come from ENV / secret store — NEVER committed here.
    # See shared/telemetry/newrelic-sink.md for the full block.
```

Resolution rule (the same rule [`@infra`](../../agents/platform/infra.md) and
[`@learner`](../../agents/platform/learner.md) apply):

> Use **NewRelic** if and only if `telemetry.sink: newrelic` **AND**
> `newrelic.enabled: true`. In **every other case** — including `sink: newrelic` with
> `enabled: false`, or missing credentials — the **local JSONL sink is authoritative**.
> A `sink: newrelic` with `enabled: false` or absent credentials is a *misconfiguration*:
> `@infra` falls back to local and flags it (`BLOCKED:sink-misconfigured`); it never reads a
> committed secret and never silently drops events.

Precedence follows the rest of `.eq-sparks.yml`: values here override platform defaults; no
secret ever lives in the file (`safety-rails`).

---

## 5. Nothing blocks before NewRelic exists

This is the load-bearing guarantee of the whole design:

- The local JSONL sink is **always on** and requires **zero provisioning** — it is created
  at run start under `.eq-sparks/telemetry/<run-id>.jsonl`.
- Until NewRelic is provisioned, the local sink is the **authoritative** record of run
  telemetry. `@infra` reads it, the console renders from it, `@learner` accrues from it.
- **No stage, gate, deploy-readiness check, or budget tally depends on NewRelic.** The G7 /
  G13 readiness reporting (`@infra`), the cache/budget telemetry (`cache-policy` §7 /
  `budget-policy`), and the curated-learning loop (`@learner`) all run end-to-end on the
  local sink alone.
- Therefore **the absence of NewRelic blocks nothing.** Provisioning NewRelic later *adds* a
  destination; it does not unblock any previously-blocked capability, because nothing was
  blocked.

---

## See also

- [`newrelic-sink.md`](./newrelic-sink.md) — the pluggable NewRelic sink: provisioning,
  event mapping, credentials (ENV/secret store), failure handling.
- [`@infra`](../../agents/platform/infra.md) — the read-only reader of the active sink;
  cost / health / G7+G13 readiness rollup.
- [`@learner`](../../agents/platform/learner.md) — consumes accrued cross-run telemetry to
  propose lessons (G14, PR-gated).
- [`memory-schema`](../memory/memory-schema.md) — the `.eq-sparks/agent-memory/<run-id>/`
  layout that shares the `<run-id>` with the telemetry file.
- [`cache-policy`](../memory/cache-policy.md) §7 — every cache hit/miss is a telemetry event.
- [`budget-policy`](../guardrails/budget-policy.md) — `budget-check` tallies telemetry into
  the run ceiling.
- [`path-policy`](../guardrails/path-policy.md) / [`safety-rails`](../guardrails/safety-rails.md)
  — telemetry writes only under `.eq-sparks/telemetry/`; no secrets in config or events.
