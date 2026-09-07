// Offline dry-run harness.
// =========================
// Replays synthetic PostHog-shaped events through the REAL decision logic in
// logic.js — audience → trigger threshold → negative conditions → cooldown /
// frequency cap → message composition — and prints, per person+trigger, exactly
// what the deployed workflow would do. It makes NO network calls, needs NO
// credentials, and never sends anything. The "draft" is a deterministic
// offline stand-in for the LiteLLM step (see logic.renderDeterministicDraft).
//
// Usage:  npm install && npm run dry-run
//         node src/dry-run.js --events examples/synthetic-events.json

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import yaml from 'js-yaml';
import {
  normalizeEvent,
  passesAudience,
  countQualifying,
  negativeConditionPresent,
  thresholdCrossed,
  cooldownDecision,
  buildDraftContext,
  renderDeterministicDraft,
} from './logic.js';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const arg = (flag, def) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};

// Prefer real config if the operator has copied it; fall back to *.example.
const pick = (base) =>
  fs.existsSync(path.join(ROOT, base)) ? base : base.replace(/\.yml$/, '.example.yml');

const loadYaml = (p) => yaml.load(fs.readFileSync(path.join(ROOT, p), 'utf8'));

const triggersCfg = loadYaml(pick('config/triggers.yml'));
const audienceCfg = loadYaml(pick('config/audience.yml'));
const schemaMap = loadYaml(pick('config/schema-map.yml'));

const suppressionPath = path.join(
  ROOT,
  fs.existsSync(path.join(ROOT, 'config/suppression.txt'))
    ? 'config/suppression.txt'
    : (audienceCfg.exclude?.suppression_list || 'config/suppression.example.txt')
);
const suppressionSet = new Set(
  fs
    .readFileSync(suppressionPath, 'utf8')
    .split('\n')
    .map((l) => l.trim().toLowerCase())
    .filter((l) => l && !l.startsWith('#'))
);

const eventsFile = arg('--events', 'examples/synthetic-events.json');
const raw = JSON.parse(fs.readFileSync(path.join(ROOT, eventsFile), 'utf8'));
const now = Date.parse(raw._meta?.now || new Date().toISOString());
const events = raw.events.map((e) => normalizeEvent(e, schemaMap));

// Group events by user.
const byUser = new Map();
for (const e of events) {
  if (!byUser.has(e.distinctId)) byUser.set(e.distinctId, []);
  byUser.get(e.distinctId).push(e);
}

const dryRun = String(process.env.DRY_RUN ?? 'true') !== 'false';
// Simulated durable send log (workflow static data in n8n). Seed it with any
// prior sends declared in the fixture so cooldown / frequency caps are testable.
const sendHistory = (raw._meta?.prior_sends || []).map((s) => ({
  personKey: String(s.personKey).toLowerCase(),
  triggerId: s.triggerId,
  at: Date.parse(s.at),
}));
const summary = { would_send: 0, suppressed: 0, no_send: 0, ineligible: 0 };

console.log('='.repeat(74));
console.log('PLG usage-signal outreach — OFFLINE DRY RUN');
console.log(`reference now = ${new Date(now).toISOString()}   DRY_RUN=${dryRun}`);
console.log(`events=${events.length}  users=${byUser.size}  triggers=${triggersCfg.triggers.length}`);
console.log('No network calls. No credentials. Nothing is sent. Data is synthetic.');
console.log('='.repeat(74));

for (const [distinctId, userEvents] of byUser) {
  const person = userEvents[0].person;
  const label = `${person.name || distinctId} <${person.email || 'no-email'}>`;
  console.log(`\n● ${label}  (plan: ${person.plan || 'n/a'})`);

  const aud = passesAudience(person, audienceCfg, suppressionSet);
  if (!aud.eligible) {
    console.log(`   ⤫ ineligible — ${aud.reason}`);
    summary.ineligible++;
    continue;
  }

  let firedForUser = false;
  let suppressedForUser = false;
  for (const trigger of triggersCfg.triggers) {
    const count = countQualifying(userEvents, trigger, now);
    if (!thresholdCrossed(count, trigger)) {
      if (count > 0) {
        console.log(`   · ${trigger.id}: ${count}/${trigger.threshold} in ${trigger.window} — below threshold`);
      }
      continue;
    }
    const neg = negativeConditionPresent(userEvents, trigger, now);
    if (neg) {
      console.log(`   ⤫ ${trigger.id}: threshold met (${count}) but negative condition "${neg}" present — suppressed`);
      summary.suppressed++;
      suppressedForUser = true;
      continue;
    }
    const personKey = (person.email || distinctId).toLowerCase();
    const cd = cooldownDecision(sendHistory, personKey, trigger, now);
    if (!cd.allowed) {
      console.log(`   ⤫ ${trigger.id}: threshold met (${count}) but ${cd.reason} — suppressed`);
      summary.suppressed++;
      suppressedForUser = true;
      continue;
    }

    const vars = buildDraftContext(person, trigger, count);
    const draft = renderDeterministicDraft(vars);

    console.log(`   ✓ ${trigger.id}: threshold crossed (${count} ≥ ${trigger.threshold} in ${trigger.window})`);
    console.log(`      → resolve contact: ${person.name} @ ${person.company} <${person.email}>`);
    if (dryRun) {
      console.log('      → DRY_RUN: NOT writing to Twenty, NOT notifying Slack, NOT recording a send.');
    } else {
      console.log('      → would upsert Twenty person + note, and notify Slack.');
    }
    console.log('      ┌─ drafted message (offline stand-in for LiteLLM) ─────────────');
    draft.split('\n').forEach((l) => console.log(`      │ ${l}`));
    console.log('      └──────────────────────────────────────────────────────────────');

    // Record the send so cooldown/frequency caps apply to later events in THIS run.
    // In dry-run the deployed workflow does NOT persist; the harness records it
    // only to demonstrate that caps would take effect.
    sendHistory.push({ personKey, triggerId: trigger.id, at: now });
    summary.would_send++;
    firedForUser = true;
  }
  if (!firedForUser && !suppressedForUser) {
    const anyActivity = triggersCfg.triggers.some((t) => countQualifying(userEvents, t, now) > 0);
    if (!anyActivity) console.log('   · no qualifying activity for any trigger');
    summary.no_send++;
  }
}

console.log('\n' + '='.repeat(74));
console.log('SUMMARY');
console.log(`  would-send : ${summary.would_send}`);
console.log(`  suppressed : ${summary.suppressed}  (negative condition / cooldown / frequency cap)`);
console.log(`  ineligible : ${summary.ineligible}  (audience / suppression list)`);
console.log(`  no-send    : ${summary.no_send}  (eligible but below threshold / no activity)`);
console.log('='.repeat(74));
