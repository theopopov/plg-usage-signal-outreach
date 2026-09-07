# Example output

Two views of the same synthetic scenario: the **offline harness** (no
credentials, deterministic) and what the **live n8n workflow** returns per event.

Everything below is SYNTHETIC. It demonstrates the decision logic — it proves
nothing about any real product's usage.

---

## A. Offline dry-run harness (`npm run dry-run`)

Input: `examples/synthetic-events.json` (42 events, 7 users), default config.

```
==========================================================================
PLG usage-signal outreach — OFFLINE DRY RUN
reference now = 2026-09-07T12:00:00.000Z   DRY_RUN=true
events=42  users=7  triggers=3
No network calls. No credentials. Nothing is sent. Data is synthetic.
==========================================================================

● Priya Nadeya <priya@brightmetric.io>  (plan: free)
   ✓ activation-nudge: threshold crossed (6 ≥ 5 in 7d)
      → resolve contact: Priya Nadeya @ Brightmetric <priya@brightmetric.io>
      → DRY_RUN: NOT writing to Twenty, NOT notifying Slack, NOT recording a send.
      ┌─ drafted message (offline stand-in for LiteLLM) ─────────────
      │ Hi Priya, I noticed Brightmetric has been using "core_action_completed"
      │ quite a bit lately (6 times in the last 7d). Happy to share a couple of
      │ things that tend to help at this stage — is there a specific outcome
      │ you're aiming for right now?
      └──────────────────────────────────────────────────────────────

● Lena Ortiz <lena@dataloom.io>  (plan: trial)
   ⤫ activation-nudge: threshold met (6) but negative condition "upgraded_plan" present — suppressed

● Marco Feld <marco@yourcompany.com>  (plan: trial)
   ⤫ ineligible — excluded-domain:yourcompany.com

● Sam Rhee <sam@nimbusworks.io>  (plan: free)
   ✓ feature-adoption: threshold crossed (11 ≥ 10 in 14d)
      → resolve contact: Sam Rhee @ Nimbusworks <sam@nimbusworks.io>
      → DRY_RUN: NOT writing to Twenty, NOT notifying Slack, NOT recording a send.
      ┌─ drafted message (offline stand-in for LiteLLM) ─────────────
      │ Hi Sam, I noticed Nimbusworks has been using "advanced_feature_used"
      │ quite a bit lately (11 times in the last 14d). ...
      └──────────────────────────────────────────────────────────────

● Ivy Chen <ivy@fjordcloud.io>  (plan: trial)
   ⤫ usage-limit-approaching: threshold met (7) but cooldown:14d — suppressed

● Rae Colton <optout@nimbusworks.io>  (plan: free)
   ⤫ ineligible — suppressed        (on the suppression list)

● Dana Whitfield <dana@northwind-labs.io>  (plan: free)
   · activation-nudge: 3/5 in 7d — below threshold

==========================================================================
SUMMARY
  would-send : 2
  suppressed : 2  (negative condition / cooldown / frequency cap)
  ineligible : 2  (audience / suppression list)
  no-send    : 1  (eligible but below threshold / no activity)
==========================================================================
```

**Why each user landed where it did**

| User | Outcome | Reason |
| --- | --- | --- |
| Priya | ✅ would-send `activation-nudge` | 6 `core_action_completed` ≥ threshold 5 in 7d, no negatives, no prior send |
| Lena | 🚫 suppressed | crossed threshold, but `upgraded_plan` in window is a negative condition |
| Marco | ⛔ ineligible | `@yourcompany.com` is an excluded internal domain |
| Sam | ✅ would-send `feature-adoption` | 11 `reports` uses ≥ 10 in 14d (the 1 `dashboards` use doesn't count — property filter) |
| Ivy | 🚫 suppressed | crossed threshold, but a prior send 3 days ago is inside the 14d cooldown |
| Rae | ⛔ ineligible | `optout@nimbusworks.io` is on the suppression list |
| Dana | · no-send | only 3 `core_action_completed` — below threshold 5 |

---

## B. Live n8n workflow — per-event HTTP responses

When you POST the same events at the running workflow (`scripts/send-synthetic.sh`,
with `DRY_RUN=true`), each returns a small JSON envelope describing what it did:

```
→ core_action_completed for priya@brightmetric.io
   {"ok":true,"action":"dry-run-preview","trigger":"activation-nudge",
    "contact":{"name":"Priya Nadeya","email":"priya@brightmetric.io","company":"Brightmetric"},
    "draft":"Hi Priya — I saw your team has run the core workflow a handful of times this week...",
    "note":"DRY_RUN=true: no CRM write, no Slack notify, no send recorded."}

→ core_action_completed for marco@yourcompany.com
   {"ok":true,"action":"skipped","reason":"excluded-domain:yourcompany.com"}

→ upgraded_plan for lena@dataloom.io
   {"ok":true,"action":"skipped","reason":"no-matching-trigger:upgraded_plan"}

→ quota_consumed for ivy@fjordcloud.io
   {"ok":true,"action":"no-send","reason":"cooldown:14d","triggerCount":7}
```

> The `draft` text in (B) is produced by LiteLLM on your key, so exact wording
> varies. In (A) the draft is a deterministic offline stand-in. Both prove the
> same thing: **the right users trigger, the wrong users are filtered, and in
> dry-run nothing is written or sent.**

Note the per-*event* vs per-*user* difference: the live workflow evaluates each
incoming event independently (that's how PostHog delivers them), so the cumulative
threshold is recomputed on each relevant event via the HogQL query. The offline
harness groups by user for a readable summary. The decision logic is identical.
