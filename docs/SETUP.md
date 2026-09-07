# Setup guide

Numbered, assuming zero prior context. You will: install the stack → connect
PostHog → map your schema → define a trigger → configure sending → dry-run on
synthetic data → interpret output → go live on a small segment → schedule →
monitor → troubleshoot.

Two things you can do **before** touching any real service:

- **Offline logic check** (no credentials): `npm install && npm run dry-run`.
  Jump to step 6 to read the output.
- Everything else needs the four services below.

---

## Prerequisites

- **Docker** + **Docker Compose** (for the self-hosted stack).
- **Node.js ≥ 18** (only for the offline harness in `src/`).
- **`jq`** and **`curl`** (only for `scripts/send-synthetic.sh`).
- Accounts/instances of the four tools (all self-hostable; PostHog and Twenty
  also offer managed cloud):
  - **PostHog** — self-host (`github.com/PostHog/posthog`) or PostHog Cloud.
  - **n8n** — bundled in this repo's `docker-compose.yml`.
  - **LiteLLM** — bundled in this repo's `docker-compose.yml`.
  - **Twenty** — self-host (`github.com/twentyhq/twenty`) or Twenty Cloud.
  - **Slack** — a workspace where you can add a bot app.
- An **LLM provider key** (Anthropic / OpenAI / etc.) for LiteLLM to call.

---

## 1. Install the orchestration stack

```bash
git clone <this-repo> plg-signal-outreach && cd plg-signal-outreach
cp .env.example .env                     # fill in as you go through these steps
cp litellm/config.example.yaml litellm/config.yaml
cp config/triggers.example.yml   config/triggers.yml
cp config/audience.example.yml   config/audience.yml
cp config/schema-map.example.yml config/schema-map.yml
docker compose up -d
```

This starts **n8n** (http://localhost:5678), **Postgres**, and the **LiteLLM
proxy** (http://localhost:4000). PostHog and Twenty are **not** started here —
you point at your own (next steps).

## 2. Dependency setup per tool

- **LiteLLM** — edit `litellm/config.yaml`: set `model:` to a model your
  provider supports and keep `api_key: os.environ/LLM_PROVIDER_API_KEY`. Put the
  real provider key in `.env` as `LLM_PROVIDER_API_KEY`, and pick a
  `LITELLM_MASTER_KEY` (any strong string). Restart: `docker compose up -d litellm`.
- **PostHog** — stand up your instance (or use Cloud). Create a **Personal API
  key** with `query:read`. Note your **numeric project id**. Put
  `POSTHOG_HOST`, `POSTHOG_PROJECT_ID`, `POSTHOG_API_KEY` in `.env`.
- **Twenty** — stand up your instance (or use Cloud). Settings → **APIs &
  Webhooks** → create an API key. Put `TWENTY_API_URL` (your `/graphql`
  endpoint) and `TWENTY_API_KEY` in `.env`.
- **Slack** — create a Slack app, add the **`chat:write`** bot scope, install to
  your workspace, invite the bot to the target channel. Put `SLACK_BOT_TOKEN`
  and `SLACK_CHANNEL_ID` in `.env`.

After editing `.env`: `docker compose up -d` (re-reads env).

## 3. Import the workflow

In the n8n UI (http://localhost:5678): top-right menu → **Import from File** →
select `workflow/n8n-workflow.json`. It imports inactive.

The workflow reads all credentials from `$env.*` (supplied by `.env` via
`docker-compose.yml`) — there are **no** stored n8n credentials to configure for
the HTTP nodes.

## 4. Connect the event source (PostHog → n8n)

In PostHog: **Data pipeline → Destinations → New destination → Webhook**.
- **URL:** `http://<your-n8n-host>:5678/webhook/plg-signal`
  (from PostHog Cloud, n8n must be reachable — use a public URL / tunnel).
- **Filter:** restrict to the events your triggers use (e.g.
  `core_action_completed`, `advanced_feature_used`, `quota_consumed`) so you
  don't POST every event.
- **Payload:** emit the shape in `src/posthog-webhook.example.json`
  (`distinct_id`, `event`, `timestamp`, `properties{...}` including the person
  fields).

## 5. Map your schema & define your first trigger

- **`config/schema-map.yml`** — change the right-hand values to match your
  PostHog event/person field names.
- **`config/triggers.yml`** — define one trigger to start: pick a real event,
  a threshold, a window, a cooldown, and (optionally) negative conditions.
- **`config/audience.yml`** — add your company domain(s) to `exclude.email_domains`
  and point `suppression_list` at your unsubscribe source.
- **`config/templates/*.md`** — adjust the prompt scaffolds to your voice.

> ⚠️ The trigger/audience/template config **also lives inline** inside the n8n
> Code nodes `Match Trigger & Audience` and `Build Prompt` (n8n can't read repo
> files). Edit both, or wire the config in via `$env` JSON. The YAML is the
> source the offline harness reads; the inline copy is what the deployed
> workflow runs. Keep them in sync.

## 6. Dry-run on synthetic data

**Offline (no services needed):**

```bash
npm install
npm run dry-run
```

Read `examples/example-output.md` for the annotated expected result. You should
see 2 would-send, 2 suppressed, 2 ineligible, 1 no-send.

**Against the running workflow (DRY_RUN=true):**

```bash
./scripts/send-synthetic.sh
```

Watch each execution in the n8n **Executions** tab. Every response has an
`action` field: `dry-run-preview`, `skipped`, or `no-send`. Nothing is written
to Twenty or Slack while `DRY_RUN=true`.

## 7. Interpret the output

- `action: dry-run-preview` → this user/event WOULD trigger; the `draft` is what
  a rep would review.
- `action: skipped` → filtered by audience, suppression, or no matching trigger.
- `action: no-send` → matched a trigger but didn't cross threshold, or hit a
  negative condition / cooldown / frequency cap. The `reason` says which.

If the wrong users trigger, tune thresholds/windows/negatives in step 5 and
re-run. **Do this until the dry-run looks right — before going live.**

## 8. Go live on a small segment

1. Narrow `config/audience.yml` `include.plans` (or add a temporary allowlist)
   to a **small** cohort.
2. Set frequency caps and cooldowns conservatively.
3. Set `DRY_RUN=false` in `.env`, `docker compose up -d`, and **activate** the
   workflow in n8n.
4. Watch the first real fires closely. Confirm the CRM record and Slack ping look
   right and that a human reviews each draft before it goes to a user.

## 9. Schedule / run cadence

This workflow is **event-driven** — PostHog pushes events as they happen, so
there is no cron. Cadence is governed by:
- your PostHog destination **filter** (which events arrive), and
- **cooldown / frequency caps** (how often any one user can be messaged).

If you prefer batch evaluation instead of real-time, replace the webhook trigger
with an n8n **Schedule** trigger that queries PostHog on an interval — but note
the source workflow is real-time by design.

## 10. Monitor

- n8n **Executions** tab: failures, retries, latency.
- Track the ratio of `dry-run-preview`/`sent` vs `skipped`/`no-send` — a sudden
  spike in sends usually means a config or data change (see step 8 of the README
  operator checklist: trigger storms).
- Watch **reply sentiment**, not just opens. A usage-triggered message that
  reads as surveillance will get flagged.

## 11. Troubleshoot

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| No executions in n8n | PostHog can't reach n8n | Check the destination URL is publicly reachable; check n8n `WEBHOOK_URL`. |
| Every event `skipped: no-matching-trigger` | event name mismatch | Align `config/triggers.yml` `event:` and the inline Code-node config with your real event names. |
| `no-send: below-threshold` when you expect a fire | window/threshold or HogQL | Confirm the HogQL returns the count you expect for that `distinct_id`; verify time window. |
| LiteLLM 401 / no draft | proxy key/model | Check `LITELLM_MASTER_KEY` matches, and `litellm/config.yaml` model + `LLM_PROVIDER_API_KEY`. |
| Twenty 400 on create | schema mismatch | The mutation is a placeholder — adapt it to your Twenty workspace schema. |
| Slack `not_in_channel` | bot not invited | Invite the bot to `SLACK_CHANNEL_ID`; confirm `chat:write`. |
| Cooldown not honored after restart | static-data store | Workflow static data is basic; move state to Postgres/Redis for durability (see README limitations). |
