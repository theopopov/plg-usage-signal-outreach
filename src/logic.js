// Core trigger / audience / cooldown / compose logic.
// =====================================================
// These are PURE functions with no I/O. They are the single reference
// implementation of the workflow's decision logic. The n8n Code nodes in
// workflow/n8n-workflow.json mirror this logic inline (n8n cannot import a
// local module); keep the two in sync when you change one. The offline
// dry-run harness (src/dry-run.js) imports these directly so the logic you
// verify locally is the same logic you deploy.

/** Parse a duration like "24h", "7d", "30d" into milliseconds. */
export function parseDuration(str) {
  const m = /^(\d+)\s*([hd])$/.exec(String(str).trim());
  if (!m) throw new Error(`Bad duration: ${str} (expected e.g. 24h, 7d, 30d)`);
  const n = Number(m[1]);
  return m[2] === 'h' ? n * 3600e3 : n * 86400e3;
}

/** Read a value from an object by the field name given in the schema map. */
function field(obj, name) {
  return obj == null ? undefined : obj[name];
}

/** Normalize a raw PostHog-shaped event using the schema map. */
export function normalizeEvent(raw, schemaMap) {
  const e = schemaMap.event;
  const props = field(raw, e.properties) || {};
  const p = schemaMap.person;
  return {
    distinctId: field(raw, e.distinct_id),
    name: field(raw, e.name),
    timestamp: field(raw, e.timestamp),
    ts: Date.parse(field(raw, e.timestamp)),
    properties: props,
    person: {
      email: props[p.email],
      name: props[p.name],
      company: props[p.company],
      plan: props[p.plan],
      marketingConsent: props[p.marketing_consent] === true || props[p.marketing_consent] === 'true',
    },
  };
}

/** Is a person eligible at all? Applied before any trigger evaluation. */
export function passesAudience(person, audience, suppressionSet) {
  const email = (person.email || '').toLowerCase();
  const req = audience.require || {};
  if (req.has_email && !email) return { eligible: false, reason: 'no-email' };
  if (req.marketing_consent && !person.marketingConsent) {
    return { eligible: false, reason: 'no-marketing-consent' };
  }
  const ex = audience.exclude || {};
  const domain = email.split('@')[1] || '';
  if ((ex.email_domains || []).map((d) => d.toLowerCase()).includes(domain)) {
    return { eligible: false, reason: `excluded-domain:${domain}` };
  }
  if ((ex.emails || []).map((x) => x.toLowerCase()).includes(email)) {
    return { eligible: false, reason: 'excluded-email' };
  }
  if (suppressionSet && suppressionSet.has(email)) {
    return { eligible: false, reason: 'suppressed' };
  }
  const inc = audience.include || {};
  if (Array.isArray(inc.plans) && inc.plans.length > 0) {
    if (!inc.plans.includes(person.plan)) {
      return { eligible: false, reason: `plan-not-in-scope:${person.plan}` };
    }
  }
  return { eligible: true, reason: 'eligible' };
}

/** Does a single event match a trigger's event name + property filters? */
export function eventMatchesTrigger(evt, trigger) {
  if (evt.name !== trigger.event) return false;
  const filters = trigger.property_filters || {};
  return Object.entries(filters).every(([k, v]) => evt.properties[k] === v);
}

/** Count qualifying events for a trigger within its rolling window. */
export function countQualifying(events, trigger, now) {
  const windowStart = now - parseDuration(trigger.window);
  return events.filter(
    (e) => eventMatchesTrigger(e, trigger) && e.ts >= windowStart && e.ts <= now
  ).length;
}

/** Is any negative (suppression) condition present within the window? */
export function negativeConditionPresent(events, trigger, now) {
  const conds = trigger.negative_conditions || [];
  if (conds.length === 0) return null;
  const windowStart = now - parseDuration(trigger.window);
  const names = new Set(conds.map((c) => c.event));
  const hit = events.find((e) => names.has(e.name) && e.ts >= windowStart && e.ts <= now);
  return hit ? hit.name : null;
}

export function thresholdCrossed(count, trigger) {
  return count >= trigger.threshold;
}

/**
 * Cooldown + frequency-cap decision.
 * sendHistory: [{ personKey, triggerId, at (ms) }]
 */
export function cooldownDecision(sendHistory, personKey, trigger, now) {
  const f = trigger.frequency || {};
  const mine = sendHistory.filter(
    (s) => s.personKey === personKey && s.triggerId === trigger.id
  );
  if (f.cooldown) {
    const cutoff = now - parseDuration(f.cooldown);
    const recent = mine.find((s) => s.at >= cutoff);
    if (recent) {
      return { allowed: false, reason: `cooldown:${trigger.frequency.cooldown}` };
    }
  }
  if (f.max_per_person != null && f.lookback) {
    const cutoff = now - parseDuration(f.lookback);
    const inWindow = mine.filter((s) => s.at >= cutoff).length;
    if (inWindow >= f.max_per_person) {
      return { allowed: false, reason: `freq-cap:${inWindow}/${f.max_per_person}` };
    }
  }
  return { allowed: true, reason: 'within-caps' };
}

/** Strip the HTML-comment header from a template and substitute {{vars}}. */
export function renderTemplate(templateText, vars) {
  const body = templateText.replace(/<!--[\s\S]*?-->\s*/g, '');
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) =>
    vars[k] != null ? String(vars[k]) : `{{${k}}}`
  );
}

/** Build the variables passed into a template / the LLM prompt. */
export function buildDraftContext(person, trigger, count) {
  const first = (person.name || '').trim().split(/\s+/)[0] || 'there';
  return {
    first_name: first,
    company: person.company || 'your team',
    plan: person.plan || 'unknown',
    trigger_event: trigger.event,
    count,
    window: trigger.window,
  };
}

/**
 * Deterministic offline stand-in for the LLM draft, used ONLY by the dry-run
 * harness when no LiteLLM proxy is available. In production, LiteLLM composes
 * the message from the same prompt scaffold; this template output is a
 * placeholder so the harness can run offline with zero credentials.
 */
export function renderDeterministicDraft(vars) {
  return (
    `Hi ${vars.first_name}, I noticed ${vars.company} has been using ` +
    `"${vars.trigger_event}" quite a bit lately (${vars.count} times in the ` +
    `last ${vars.window}). Happy to share a couple of things that tend to help ` +
    `at this stage — is there a specific outcome you're aiming for right now?`
  );
}
