# PLG Usage-Signal Outreach

**Trigger sales outreach off your own product usage — the one intent signal that
isn't a bought false positive.**

Self-hosted **PostHog** watches your first-party product events. When a user
crosses a **usage threshold** you define, PostHog's native webhook fires into
**n8n**, which computes the cumulative threshold, applies audience filters and
negative conditions, checks cooldown/frequency caps, then asks a self-hosted
**LiteLLM** proxy to draft a context-aware message and — unless you're in
dry-run — writes the lead to **Twenty** CRM and pings a rep in **Slack** to
review and send. It is **human-in-the-loop**: nothing is auto-sent to the end
user. Bought "intent" data is a false-positive firehose; your own product usage
isn't.

```
 PostHog                n8n (rule engine)                          outputs
 ───────                ─────────────────                          ───────
 product   ──webhook──▶ audience filter ─▶ HogQL threshold ─▶ negatives ─▶ cooldown
 events                                                                      │
                                                                             ▼
                                            LiteLLM ◀── compose context-aware draft
                                               │
                                    DRY_RUN? ──┴── no ──▶ Twenty CRM record  ─▶ Slack ping (rep reviews & sends)
                                               └── yes ─▶ preview only (no write, no send)
```

> This is one faithful implementation of the workflow "Trigger outreach off your
> own product usage." The final stack, sequence, and configuration depend on
> your business and goal. Everything specific to any one company is user-supplied
> configuration with neutral defaults.

- **Stack:** PostHog (MIT core) · n8n (Sustainable Use License, source-available)
  · LiteLLM (MIT core) · Twenty (AGPL-3.0) + Slack
- **This repo:** MIT. Orchestration only — see [licensing](#licensing).
- **Cost basis:** ~$20–$45/mo self-hosted infra + pay-as-you-go LLM tokens. See
  [docs/COSTS.md](docs/COSTS.md).

---

## Quickstart (offline, no credentials)

Verify the decision logic in 30 seconds without any service:

```bash
npm install
npm run dry-run
```

You'll see synthetic users routed to **would-send / suppressed / ineligible /
no-send** with the reason for each. Annotated walkthrough:
[examples/example-output.md](examples/example-output.md). Full stack setup:
[docs/SETUP.md](docs/SETUP.md).

---

## What it does (mechanism)

PostHog captures first-party product events (`distinct_id`, event name,
timestamp, properties). A PostHog **Webhook destination**, filtered to the events
your triggers care about, POSTs matching events to an n8n webhook. n8n then, per
event: (1) resolves the person and applies **audience filters** (internal/test
domains, suppression list, optional consent gate); (2) runs a **HogQL query**
back against PostHog to count the trigger event over a rolling **window** and
compute whether the **cumulative threshold** is crossed; (3) checks **negative
conditions** (e.g. "already upgraded") and **cooldown/frequency caps**;
(4) asks **LiteLLM** to draft a short, context-aware message from the usage
signal; (5) unless `DRY_RUN`, creates a **Twenty** CRM record and notifies a rep
in **Slack** with the draft to review and send; (6) records the send so caps
apply next time.

The threshold is computed **in n8n**, not in PostHog: PostHog's native webhook
fires per-event on a filter, so the *aggregate* "crossed N in the window" is
evaluated in the orchestrator — exactly what the source describes ("the threshold
rule … [is] glue").

---

## Use cases

Each is a trigger definition + a goal. All are configured in
`config/triggers.yml`; the repo ships neutral examples for the first three.

| Use case | What triggers it | What the outreach is trying to do |
| --- | --- | --- |
| **Activation nudge** | New user repeats the core action ≥ N times in the first days | Get them from "tried it" to "rely on it" before they drift |
| **Feature-adoption prompt** | Repeated use of a specific advanced feature | Deepen adoption; surface an adjacent capability |
| **Usage-limit / upgrade** | Consumption approaches a plan/quota limit | Offer the right plan *before* they hit a wall |
| **Expansion signal** | Multiple seats/projects active, or usage growing week-over-week | Start a seat/tier expansion conversation |
| **Power-user identification** | Top-decile usage of key actions | Recruit champions, case studies, referrals |
| **Onboarding drop-off** | Signed up, completed setup, then **stopped** before the aha-moment | Re-engage with targeted help at the exact stall point |
| **Churn-risk intervention** | Sharp drop in usage vs. the prior period from a previously active user | Intervene before the renewal/cancel decision |
| **Reactivation** | A dormant user returns and performs a meaningful action | Catch the re-engagement window while intent is live |

Drop-off, churn-risk, and reactivation are **decrease / absence** patterns — they
need a comparison window (this period vs. last), which you express as a low
threshold on recent activity combined with a negative condition on the earlier
window. See signal design below.

---

## Product types this fits

- **Self-serve / product-led (PLG)** SaaS where users sign up and use the product
  before talking to sales.
- Products with **rich, observable usage** — frequent, meaningful events per user.
- **Usage-based or seat-based** pricing, where consumption maps to expansion.
- **Digital delivery** — the value is produced in-product, so usage is the truth.
- Teams that already run **product analytics** (PostHog or equivalent) — setup is
  ~half a day when events already exist.

## Product types this does **not** fit

Say plainly where this is the wrong tool:

- **Thin usage signal** — low-frequency products (annual filing tools, one-shot
  utilities) never accumulate enough events for a meaningful threshold.
- **Long enterprise sales cycles** dominated by committees and procurement, where
  a single user's usage doesn't predict a buying moment.
- **Offline or human-delivered value** — if the product isn't where the work
  happens, product events don't represent intent.
- **Privacy-constrained categories** (health, children's, certain fintech) where
  using behavioral data for marketing is restricted or reputationally toxic.
- **Pre-product-market-fit** with too few users — you'll tune thresholds on noise.
- **No analytics in place** — if you aren't already capturing events, that's a
  bigger project than this workflow.

---

## Trigger types and signal design

The quality of this system is the quality of your triggers. Product usage is a
*reliable* signal (it's real behavior), but not every pattern is a *good* trigger.

**Patterns that make good triggers** (sharp, causal, actionable):
- **Repeated core action** in a short window — activation is a count, not a login.
- **A specific advanced-feature threshold** — narrow with `property_filters` so
  "used reports 10×" doesn't get diluted by unrelated feature use.
- **Approaching a real limit** — quota/seat consumption near a plan boundary.
- **Event *sequences*** — setup completed **then** core action (true activation),
  expressed as a threshold plus a negative condition on the "not yet done" step.
- **Change vs. a baseline** — a drop or spike relative to the prior window.

**Patterns that look good but produce noise** (avoid or harden):
- **Raw logins / page views** — presence isn't intent; easily gamed by tabs left open.
- **A single occurrence** — one event is an accident; require a count.
- **Vanity events** with no tie to value — they fire constantly and mean nothing.
- **Thresholds set on too-short a window** — catch transient bursts, not habits.
- **Signals that fire at the wrong lifecycle stage** — "used feature X" is noise
  if they already upgraded (that's what negative conditions are for).

**Choosing a threshold:** start from your own activation/expansion data — what
usage level *actually* correlates with conversion or retention — and set the
threshold just below it. If you don't have that yet, start **high** (fewer, more
qualified fires) and lower it as you learn. Run the offline harness against a
sample to see how many users would fire at each level before going live.

**Choosing a window:** long enough to capture a habit, short enough that the
signal is still fresh. Days-to-weeks for activation/adoption; a full billing
period for usage-limit; period-over-period for churn/reactivation. Too long
dilutes causality; too short catches noise.

---

## Where it works well, and why

- **The signal is first-party and real** — you're acting on what users *did* in
  your product, not on a vendor's guess. No "intent data" false positives.
- **You own the scoring logic** — thresholds, windows, and negatives are yours,
  versioned in config, with no per-seat PQL-tool pricing or lock-in.
- **Low friction** — PostHog emits the trigger natively; the rest is glue + one
  LLM call + two API writes.
- **Human-in-the-loop by design** — a rep reviews every draft, so tone and
  consent stay accountable at the moment of contact.
- **Cheap to run** — cost scales with *qualified sends*, not raw event volume.

---

## Limitations and failure modes

Be clear-eyed about these — most incidents here are self-inflicted config or data
problems, not tool failures.

- **Event-data quality & latency** — missing/duplicated events, or delayed
  ingestion, make thresholds fire late, twice, or not at all. Garbage events →
  garbage triggers.
- **Identity-resolution failures** — if `distinct_id` isn't reliably tied to a
  real email/person (anonymous → identified merges, multiple devices, shared
  accounts), contact resolution breaks or messages the wrong person.
- **False positives** — a threshold crossed for the wrong reason (a script, a
  QA run, a one-off spike) triggers outreach that reads as noise.
- **Wrong-lifecycle firing** — messaging a user who already upgraded or already
  has sales engaged. Mitigated by **negative conditions** — but only if you
  configure them.
- **Over-messaging** — without cooldowns/caps, an active user gets pinged
  repeatedly; this hurts deliverability *and* relationships.
- **Trigger storms** — a deploy that renames/duplicates events, or a **data
  backfill**, can replay history and fire thousands of triggers at once. Always
  re-verify in dry-run after event changes.
- **Deliverability** — the downstream human send can still land in spam; this
  workflow doesn't manage bounces/complaints.
- **Attribution difficulty** — proving the message *caused* the conversion is
  hard; usage-triggered users often would have converted anyway. Measure
  incrementally (holdout), not by raw open rates.
- **The "surveillance" risk** — a message that too precisely narrates a user's
  behavior feels creepy. Draft to be helpful, not to show off your telemetry.
- **State durability** — the shipped cooldown store uses n8n workflow static
  data (basic, per-workflow). For production, move it to Postgres/Redis so caps
  survive restarts and multiple workflows.

---

## What to pay attention to — operator checklist

- [ ] **Always dry-run first.** `npm run dry-run` and/or `DRY_RUN=true` in n8n.
      Confirm the *right* users fire before any real send.
- [ ] **Set frequency caps and cooldowns before going live** — not after.
- [ ] **Honor unsubscribes and suppression lists** — wire real opt-outs into
      `config/audience.yml` `suppression_list`.
- [ ] **Exclude internal and test accounts** — your own domain(s) in
      `exclude.email_domains`. Employees are not prospects and they skew metrics.
- [ ] **Watch for trigger storms after a deploy or backfill** — event renames and
      history replays fire everything at once. Re-verify in dry-run after any
      instrumentation or data change.
- [ ] **Monitor reply *sentiment*, not just open rates** — usage-triggered
      messages can feel invasive; a rising "how do you know that?" reply rate is
      a red flag.
- [ ] **Review templates for anything that reads as surveillance** — reference the
      value, not the surveillance ("you've been building reports" → good;
      "we tracked you opening reports 11 times" → bad).
- [ ] **Confirm a human reviews each draft** before it reaches a user.
- [ ] **Pick your lawful basis deliberately** — enable `require.marketing_consent`
      if consent is your basis (see [docs/COMPLIANCE.md](docs/COMPLIANCE.md)).

---

## Examples

**Example input event** (`src/posthog-webhook.example.json`, synthetic):

```json
{
  "distinct_id": "u_priya",
  "event": "core_action_completed",
  "timestamp": "2026-09-07T10:15:00Z",
  "properties": {
    "email": "priya@brightmetric.io", "name": "Priya Nadeya",
    "company": "Brightmetric", "plan": "free", "marketing_consent": true
  }
}
```

**Example trigger config** (`config/triggers.example.yml`, excerpt):

```yaml
triggers:
  - id: activation-nudge
    event: core_action_completed
    threshold: 5            # cumulative occurrences...
    window: 7d              # ...over this rolling window
    frequency: { cooldown: 30d, max_per_person: 1, lookback: 90d }
    negative_conditions:
      - event: upgraded_plan        # already converted — don't nudge
      - event: contacted_by_sales   # avoid conflicting touch
    template: activation-nudge
```

**Example result** — the offline harness routes 7 synthetic users:

```
● Priya  ✓ activation-nudge fires (6 ≥ 5 in 7d) → draft + would-notify rep
● Lena   ⤫ suppressed (negative condition: upgraded_plan in window)
● Marco  ⛔ ineligible (excluded internal domain)
● Sam    ✓ feature-adoption fires (11 ≥ 10 in 14d)
● Ivy    ⤫ suppressed (cooldown: prior send within 14d)
● Rae    ⛔ ineligible (on suppression list)
● Dana   · no-send (3 < 5 — below threshold)
SUMMARY  would-send:2  suppressed:2  ineligible:2  no-send:1
```

Full annotated output: [examples/example-output.md](examples/example-output.md).

---

## Configuration surface

Everything company-specific is config. Copy each `*.example.*` to the real name
(gitignored) and edit.

| File | What you control |
| --- | --- |
| `.env` | Service hosts + credentials; `DRY_RUN` |
| `config/triggers.yml` | Trigger definitions: event, threshold, window, property filters, cooldown, frequency cap, negative conditions, template |
| `config/audience.yml` | Include (plans), exclude (internal domains, emails, suppression list), require (email, consent) |
| `config/schema-map.yml` | Map your PostHog event/person field names onto the workflow's fields |
| `config/templates/*.md` | Prompt scaffolds LiteLLM uses to draft each message |
| `config/suppression.txt` | Opt-out list (real file gitignored) |
| `litellm/config.yaml` | Which LLM model/provider LiteLLM routes to |

> The trigger/audience/template config is also inlined inside the n8n Code nodes
> (`Match Trigger & Audience`, `Build Prompt`) because n8n can't read repo files.
> The YAML is what the offline harness reads; the inline copy is what the
> deployed workflow runs. **Keep them in sync**, or wire config in via `$env`.

---

## Data handling & compliance (summary)

This workflow processes identifiable users' usage data and triggers outreach, so
it sits inside GDPR/CCPA and CAN-SPAM/CASL. In short: usage data stays in **your**
PostHog/n8n/Twenty; the **only** external hop is the LLM call (point LiteLLM at a
local model to avoid it); pick a **lawful basis** (legitimate interest or
consent) deliberately; **messaging your own users off their own behavior is
materially more defensible than cold contact — but not automatic**; and because
the workflow is human-in-the-loop, the send obligation sits with a person who
must honor suppression and consent. Full detail, including the consent gate and
the your-users-vs-cold-contact distinction, in
[docs/COMPLIANCE.md](docs/COMPLIANCE.md). **Not legal advice.**

---

## Files

| Path | Role |
| --- | --- |
| `workflow/n8n-workflow.json` | The importable 17-node n8n workflow (the mechanism) |
| `docker-compose.yml` | Self-hosted n8n + Postgres + LiteLLM (pinned images) |
| `.env.example` | Every credential/behavior var; no real values |
| `config/` | Trigger, audience, schema-map, template, suppression config |
| `litellm/config.example.yaml` | LiteLLM model routing (keys via env) |
| `src/logic.js` | Pure decision logic (threshold/audience/cooldown/compose) |
| `src/dry-run.js` | Offline harness that replays synthetic events through `logic.js` |
| `src/posthog-webhook.example.json` | Expected PostHog webhook payload shape |
| `examples/synthetic-events.json` | Synthetic events exercising every branch |
| `examples/example-output.md` | Annotated dry-run output |
| `scripts/send-synthetic.sh` | POST synthetic events at a running n8n (live dry-run) |
| `docs/SETUP.md` · `docs/COSTS.md` · `docs/COMPLIANCE.md` | Setup, cost, compliance |

---

## Licensing

This repository is **MIT** and is **orchestration/glue only** — a docker-compose
that pulls official images plus an n8n workflow that calls the tools over their
published network APIs. It does **not** vendor, bundle, or modify any tool's
source. Under the standard interpretation, calling a service over its published
API is not a derivative work, so neither **Twenty's AGPL-3.0** (which also grants
an explicit API "Application Exception") nor **n8n's Sustainable Use License**
(a use restriction, permitting internal business use) places obligations on this
repo. If you instead **modify** those tools' source, or **resell/host them as a
service** to third parties, re-check their licenses. **Not legal advice.**

Tool licenses: PostHog MIT (core; `ee/` proprietary) · n8n Sustainable Use
License (source-available, not OSI open source) · LiteLLM MIT (core;
`enterprise/` proprietary) · Twenty AGPL-3.0 (+ Application Exception) · Slack
proprietary service.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Issues and PRs welcome, especially
adapters for other analytics sources, CRMs, and sending channels — kept faithful
to the human-in-the-loop, first-party-signal design.
