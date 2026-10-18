'use strict';

/**
 * What an agent step may do (docs/superpowers/specs/2026-10-18-computer-agent-design.md §5.2), and the reading of the
 * AI's reply to one step. A step is JSON: {"say": "...", "thought": "...", "risky": false, "action": {"type": ..., ...}}.
 * parseStep never throws: a reply it cannot use comes back as { ok: false, error }, with the reason in words the AI
 * reads on its next step. Android has a port (later), checked against the same cases.
 */

const { readJson } = require('../prompts');

const STEP_LIMITS = {
  say: 60, thought: 200, text: 4000, command: 1000, path: 1000, url: 2000, name: 200, combo: 40, question: 300,
  summary: 600, option: 200, menuItems: 6, waitMs: 3000,
};
const FILE_OPS = ['list', 'find', 'read', 'new_folder', 'copy', 'move', 'rename', 'trash', 'write'];
const SCROLL_DIRS = ['up', 'down', 'left', 'right'];
const ID = /^e\d{1,5}$/;

// Field kinds: text (cut to its limit), id (e12), bool, num (rounded), dir, op, point ({x, y}), list (menu path).
const ACTION_TYPES = {
  open_app: { fields: { name: 'text:name' } },
  open_url: { fields: { url: 'text:url' } },
  open_file: { fields: { path: 'text:path' } },
  open_settings: { fields: { page: 'text:name' } },
  menu: { fields: { path: 'list' } },
  keys: { fields: { combo: 'text:combo' } },
  type: { fields: { text: 'text:text' }, optional: { id: 'id' } },
  run: { fields: { command: 'text:command' } },
  files: { fields: { op: 'op', path: 'text:path' }, optional: { to: 'text:path', text: 'text:text' } },
  click: { fields: { id: 'id' } },
  set_value: { fields: { id: 'id', text: 'text:text' } },
  toggle: { fields: { id: 'id', on: 'bool' } },
  pick: { fields: { id: 'id', option: 'text:option' } },
  scroll: { fields: { dir: 'dir' }, optional: { id: 'id' } },
  focus: { fields: { id: 'id' } },
  click_at: { fields: { x: 'num', y: 'num' }, optional: { double: 'bool', right: 'bool' } },
  drag: { fields: { from: 'point', to: 'point' } },
  look: { fields: {} },
  wait: { fields: { ms: 'num' } },
  handover: { fields: { why: 'text:question' } },
  ask_user: { fields: { question: 'text:question' } },
  done: { fields: { summary: 'text:summary' } },
  stuck: { fields: { reason: 'text:summary' } },
};
const MAC_ABILITIES = Object.freeze(Object.keys(ACTION_TYPES));

const cut = (value, max) => String(value).trim().slice(0, max);
const isNum = (v) => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)));

/** One field read by its kind: { value } or { error }. */
function readField(name, kind, raw) {
  const [base, limit] = kind.split(':');
  if (base === 'text') {
    if (typeof raw !== 'string' || !raw.trim()) return { error: `"${name}" must be text` };
    return { value: cut(raw, STEP_LIMITS[limit]) };
  }
  if (base === 'id') return typeof raw === 'string' && ID.test(raw) ? { value: raw } : { error: `"${name}" must be an element id like e12` };
  if (base === 'bool') return typeof raw === 'boolean' ? { value: raw } : { error: `"${name}" must be true or false` };
  if (base === 'num') return isNum(raw) ? { value: Math.round(Number(raw)) } : { error: `"${name}" must be a number` };
  if (base === 'dir') return SCROLL_DIRS.includes(raw) ? { value: raw } : { error: `"dir" must be one of ${SCROLL_DIRS.join(', ')}` };
  if (base === 'op') return FILE_OPS.includes(raw) ? { value: raw } : { error: `"op" must be one of ${FILE_OPS.join(', ')}` };
  if (base === 'point') {
    if (!raw || !isNum(raw.x) || !isNum(raw.y)) return { error: `"${name}" must be {"x": number, "y": number}` };
    return { value: { x: Math.round(Number(raw.x)), y: Math.round(Number(raw.y)) } };
  }
  if (base === 'list') {
    const items = Array.isArray(raw) ? raw.filter((t) => typeof t === 'string' && t.trim()).map((t) => cut(t, STEP_LIMITS.name)) : [];
    if (!items.length || items.length > STEP_LIMITS.menuItems) return { error: `"path" must be 1 to ${STEP_LIMITS.menuItems} menu titles` };
    return { value: items };
  }
  return { error: `"${name}" is not known` };
}

function parseStep(text, { abilities = MAC_ABILITIES } = {}) {
  const j = readJson(String(text || '').trim());
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { ok: false, error: 'Reply with one JSON object only.' };
  const a = j.action;
  if (!a || typeof a !== 'object' || Array.isArray(a) || typeof a.type !== 'string') {
    return { ok: false, error: 'The reply needs an "action" with a "type".' };
  }
  const spec = Object.hasOwn(ACTION_TYPES, a.type) ? ACTION_TYPES[a.type] : null;
  if (!spec) return { ok: false, error: `There is no action "${cut(a.type, 40)}".` };
  if (!abilities.includes(a.type)) return { ok: false, error: `This device cannot do "${a.type}".` };
  const action = { type: a.type };
  for (const [name, kind] of Object.entries(spec.fields)) {
    const r = readField(name, kind, a[name]);
    if (r.error) return { ok: false, error: `${a.type}: ${r.error}.` };
    action[name] = r.value;
  }
  for (const [name, kind] of Object.entries(spec.optional || {})) {
    if (a[name] === undefined || a[name] === null || a[name] === '') continue;
    const r = readField(name, kind, a[name]);
    if (r.error) return { ok: false, error: `${a.type}: ${r.error}.` };
    action[name] = r.value;
  }
  if (action.type === 'wait') action.ms = Math.max(0, Math.min(action.ms, STEP_LIMITS.waitMs));
  return {
    ok: true,
    say: typeof j.say === 'string' ? cut(j.say, STEP_LIMITS.say) : '',
    thought: typeof j.thought === 'string' ? cut(j.thought, STEP_LIMITS.thought) : '',
    risky: j.risky === true,
    action,
  };
}

/** The action in a few words, for the log the AI reads on its next step. */
function describe(action) {
  const q = (s) => `"${String(s).slice(0, 80)}"`;
  switch (action.type) {
    case 'open_app': return `open_app ${q(action.name)}`;
    case 'open_url': return `open_url ${q(action.url)}`;
    case 'open_file': return `open_file ${q(action.path)}`;
    case 'open_settings': return `open_settings ${q(action.page)}`;
    case 'menu': return `menu ${q(action.path.join(' > '))}`;
    case 'keys': return `keys ${q(action.combo)}`;
    case 'type': return `type ${q(action.text)}${action.id ? ` into ${action.id}` : ''}`;
    case 'run': return `run ${q(action.command)}`;
    case 'files': return `files ${action.op} ${q(action.path)}${action.to ? ` to ${q(action.to)}` : ''}`;
    case 'set_value': return `set_value ${action.id} ${q(action.text)}`;
    case 'toggle': return `toggle ${action.id} ${action.on ? 'on' : 'off'}`;
    case 'pick': return `pick ${action.id} ${q(action.option)}`;
    case 'scroll': return `scroll ${action.dir}${action.id ? ` in ${action.id}` : ''}`;
    case 'click_at': return `click_at ${action.x},${action.y}`;
    case 'drag': return `drag ${action.from.x},${action.from.y} to ${action.to.x},${action.to.y}`;
    case 'wait': return `wait ${action.ms} ms`;
    case 'handover': return `handover ${q(action.why)}`;
    case 'ask_user': return `ask_user ${q(action.question)}`;
    default: return action.id ? `${action.type} ${action.id}` : action.type;
  }
}

module.exports = { ACTION_TYPES, FILE_OPS, SCROLL_DIRS, STEP_LIMITS, MAC_ABILITIES, parseStep, describe };
