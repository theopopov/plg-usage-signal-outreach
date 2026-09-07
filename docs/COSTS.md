# Cost documentation

This workflow is designed to run cheaply because the only reliable intent signal
— your own product usage — is data you already own. The source thesis quotes a
running basis of **~$20–$45/month** for self-hosted product-analytics infra plus
a small VPS and pay-as-you-go LLM tokens. There is **no subscription saving
claimed**: the comparable product-qualified-lead (PQL) tools it replaces are
quote-only, so there is no public figure to net against.

> **Verified vs. estimated.** The tools, licenses, and free-tier *existence* were
> verified (Sep 2026). Specific dollar figures below are **ESTIMATES / formulas**
> — vendor pricing changes and depends on your volume, region, and plan. Treat
> every `$` as "check current pricing," and use the formulas to compute your own.
> Nothing here is a quote.

## Per-step cost

| Step | Service | Pricing model | Cost driver | Notes |
| --- | --- | --- | --- | --- |
| Capture | **PostHog** | Self-host: infra only. Cloud: event-volume based, with a monthly free allotment. | # of events ingested | Self-hosting removes per-event fees but adds infra + ops. *(free-tier exists; verify size)* |
| Orchestrate | **n8n** | Self-host: infra only (this repo). Cloud: per-execution/plan. | # of workflow executions | Self-hosted here = **$0 in license**, infra only. |
| Compose | **LiteLLM** | The proxy is free (MIT). You pay the **upstream LLM** per token. | # of sends × tokens/send | This is the main variable cost. Formula below. |
| CRM write | **Twenty** | Self-host: infra only. Cloud: per-seat. | # of sales seats | Only fires on a real send (not dry-run, not suppressed). |
| Notify | **Slack** | Free tier exists; paid per active user. | # of Slack users | One `chat.postMessage` per fire — negligible. |
| Host | **VPS** | Flat monthly. | RAM/CPU for the stack | PostHog self-host is the heavy piece; n8n+LiteLLM are light. |

## The one variable cost worth modeling: LLM tokens

Every **send** (not every event — only events that pass audience + threshold +
suppression + caps) makes **one** LiteLLM call. Estimate:

```
monthly_llm_cost ≈ sends_per_month
                 × (input_tokens + output_tokens) per send
                 × provider_price_per_token
```

Rough per-send token size for the built-in templates: **~300–600 input** +
**~120–200 output** tokens (short prompt, short message). So:

- **100 sends/mo:** ~50k–80k tokens total → cents to a low-single-digit dollars
  on most current models. *(estimate)*
- **1,000 sends/mo:** ~0.5M–0.8M tokens → typically a few dollars to low tens,
  model-dependent. *(estimate)*
- **10,000 sends/mo:** ~5M–8M tokens → tens of dollars, model-dependent.
  *(estimate)*

Because the workflow only calls the LLM **after** all filters, cost scales with
*qualified sends*, not with raw event volume. This is the key knob.

**Knobs that drive cost:**
- **Threshold / window / audience** → how many sends qualify (biggest lever).
- **Model choice in `litellm/config.yaml`** → per-token price (use a smaller
  model for drafting to cut cost sharply).
- **`max_tokens`** in the LiteLLM node → caps output length.
- **DRY_RUN** in the offline harness → **$0** (no LLM call; uses a deterministic
  stand-in). In n8n, dry-run *does* call the LLM to preview the real draft —
  disable that node while load-testing if you want zero token spend.
- **PostHog event volume** → ingestion cost (self-host: infra; cloud: per-event).

## Free-tier coverage (verify current terms)

- **PostHog** — offers a monthly free event allotment on Cloud; self-host is
  "free" in license but you pay infra. *(exists; size unverified here)*
- **n8n** — self-hosted under the Sustainable Use License: **no license fee** for
  internal use. *(verified: SUL permits internal business use)*
- **LiteLLM** — MIT, **free** to run. You only pay the upstream provider. *(verified: MIT)*
- **Twenty** — AGPL, **free** to self-host; Cloud is per-seat. *(verified: AGPL)*
- **Slack** — free tier exists for small workspaces. *(exists; verify limits)*

## Free / cheaper alternatives per step

- **LLM (biggest cost):** point LiteLLM at a **local** model (Ollama / vLLM) for
  ~$0 marginal token cost — LiteLLM supports local backends. Trade quality/latency.
- **CRM:** if you don't need Twenty, the Slack notification alone (human-in-the-loop)
  is enough to action a lead — drop the Twenty node.
- **Analytics:** if you already emit events elsewhere, you can replace the PostHog
  query with your own store — but that departs from the named stack.

## What this does NOT cost

- **No per-seat PQL-tool subscription** (the category this replaces is quote-only
  and typically enterprise-priced).
- **No per-event "intent data" purchase** — the signal is first-party.
