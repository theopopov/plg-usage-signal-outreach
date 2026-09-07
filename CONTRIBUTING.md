# Contributing

Thanks for your interest. This project reproduces a single workflow — *trigger
outreach off your own product usage* — as a generic, self-hostable stack. The
goal is faithfulness to that design, not feature growth.

## Principles

- **Stay faithful to the named stack.** The workflow is PostHog → n8n → LiteLLM →
  Twenty + Slack, **human-in-the-loop** (draft + notify a rep; never auto-send to
  the end user). Changes that quietly turn this into an auto-mailer, or swap the
  core tools, are out of scope for the main branch — propose them as clearly
  labeled adapters/extensions.
- **Keep it generic.** No company-specific products, event names, thresholds,
  copy, or naming. Everything specific is user config with neutral defaults.
- **Zero secrets, ever.** No keys, tokens, endpoints, or real user data in code,
  config, examples, or commits. Sample data must be synthetic.
- **No invented functionality.** Don't add integrations or steps absent from the
  source workflow to the core; extensions belong behind a clear boundary.

## What's especially welcome

- **Source adapters** — other product-analytics tools that can emit a webhook
  (keep the PostHog path as the default).
- **CRM adapters** — other CRMs alongside the Twenty path.
- **Channel adapters** — other rep-notification channels alongside Slack.
- **Durable state** — a Postgres/Redis-backed cooldown store to replace the
  basic workflow-static-data implementation.
- **Docs** — clearer setup, more worked trigger examples, better compliance notes.

## Keeping logic in sync

The decision logic lives in **two** places by necessity:

- `src/logic.js` — the reference implementation the offline harness runs.
- The n8n Code nodes (`Match Trigger & Audience`, `Evaluate + Cooldown`,
  `Build Prompt`) — inlined because n8n can't import repo files.

If you change one, change the other, and update `examples/synthetic-events.json`
+ `examples/example-output.md` so the dry-run still demonstrates every branch.

## Before you open a PR

1. `npm install && npm run dry-run` — the summary must stay coherent
   (would-send / suppressed / ineligible / no-send all reachable).
2. Regenerate/validate `workflow/n8n-workflow.json` if you touched it (it must be
   valid JSON with every connection target and `$('Node')` reference resolving).
3. Grep your diff for secrets and real emails/domains.
4. Keep the README's claims honest — mark estimates as estimates.

## Reporting issues

Include: what you configured (redact secrets), what you expected, what happened,
and the relevant n8n execution output or `dry-run` summary.
