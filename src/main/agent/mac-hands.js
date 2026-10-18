'use strict';

/**
 * The agent's hands and eyes on the Mac (spec §6.5): the helper's tree, acts and screenshot (src/native/BuddyHelper.swift),
 * and the rest in Node: shell commands, files, links and apps. It never decides risk (shared/agent/safety.js does,
 * before every act); it still never looks at or acts in a password app. Nothing it reads is logged.
 */

const path = require('node:path');
const fsp = require('node:fs/promises');
const { BuddyError } = require('../../../shared/errors');
const { isPasswordApp, riskOf, KEY_NAMES, KEY_MODIFIERS } = require('../../../shared/agent/safety');

const MAX_NODES = 600;
const SHOT_EDGE = 1280;
const RUN_TIMEOUT_MS = 30_000;
const RUN_OUTPUT = 2000;
const RUN_BUFFER = 64 * 1024;
const READ_MAX = 8000;
const LIST_MAX = 100;
const OPEN_WAIT_MS = 6000;
const SETTLE_MS = 400;
const STOPPERS = ['no_accessibility', 'no_screen_recording'];
const STEP_NOTES = {
  focus_unknown: "I can't tell where the cursor is, so I didn't type.",
  secure_field: "I don't type into password fields.",
  stale_id: 'That is not on the screen any more. Look again.',
  focus_failed: "I couldn't put the cursor there.",
  press_failed: "I couldn't use that control.",
};

const ROLE_NAMES = {
  AXWindow: 'window', AXSheet: 'sheet', AXButton: 'button', AXTextField: 'textfield', AXTextArea: 'textarea',
  AXSecureTextField: 'password-field', AXCheckBox: 'checkbox', AXRadioButton: 'radio', AXPopUpButton: 'popup',
  AXMenuButton: 'menubutton', AXComboBox: 'combobox', AXStaticText: 'text', AXLink: 'link', AXRow: 'row', AXCell: 'cell',
  AXSlider: 'slider', AXImage: 'image', AXMenuItem: 'menuitem', AXList: 'list', AXTable: 'table', AXOutline: 'outline',
  AXHeading: 'heading', AXWebArea: 'webarea', AXToolbar: 'toolbar', AXTabGroup: 'tabs', AXIncrementor: 'incrementor',
  AXDisclosureTriangle: 'disclosure', AXSearchField: 'searchfield', AXColumn: 'column',
};
const SETTINGS_PAGES = {
  appearance: 'com.apple.Appearance-Settings.extension', wifi: 'com.apple.wifi-settings-extension',
  bluetooth: 'com.apple.BluetoothSettings', sound: 'com.apple.Sound-Settings.extension',
  display: 'com.apple.Displays-Settings.extension', notifications: 'com.apple.Notifications-Settings.extension',
  privacy: 'com.apple.settings.PrivacySecurity.extension', battery: 'com.apple.Battery-Settings.extension',
  network: 'com.apple.Network-Settings.extension', focus: 'com.apple.Focus-Settings.extension',
  keyboard: 'com.apple.Keyboard-Settings.extension', general: 'com.apple.systempreferences.GeneralSettings',
  desktop: 'com.apple.Wallpaper-Settings.extension',
};
const URL_SCHEMES = ['http:', 'https:', 'mailto:', 'tel:', 'sms:', 'facetime:', 'facetime-audio:'];
const DRAIN_MS = 100;
const FIND_LINES = 30;

function roleName(node) {
  if (node.secure || node.subrole === 'AXSecureTextField') return 'password-field';
  if (node.subrole === 'AXSearchField') return 'searchfield';
  if (node.role === 'AXCheckBox' && node.subrole === 'AXSwitch') return 'switch';
  if (node.subrole === 'AXDialog' || node.subrole === 'AXSystemDialog') return 'dialog';
  return ROLE_NAMES[node.role] || String(node.role || '').replace(/^AX/, '').toLowerCase();
}

function toElement(node, focused) {
  const role = roleName(node);
  const toggle = role === 'checkbox' || role === 'switch' || role === 'radio';
  const state = [
    toggle && node.value !== undefined ? (node.value === '1' ? 'on' : 'off') : '',
    node.selected ? 'selected' : '', node.id === focused ? 'focused' : '', node.disabled ? 'disabled' : '',
  ].filter(Boolean).join(' ');
  const out = { id: node.id, role, subrole: node.subrole || '', name: node.name || node.description || '', state, depth: node.depth || 0, frame: node.frame || null };
  if (node.description) out.description = node.description;
  if (!toggle && role !== 'password-field' && node.value !== undefined) out.value = node.value;
  return out;
}

const centre = (f) => ({ x: f.x + f.width / 2, y: f.y + f.height / 2 });
const failed = (code, note) => ({ ok: false, code, note });

/** The last non-empty line of the focused text (a terminal's current line), or ''. */
function lastLine(el) {
  if (!el || typeof el.value !== 'string') return '';
  const lines = el.value.split('\n').map((l) => l.trim()).filter(Boolean);
  return (lines.at(-1) || '').slice(0, 200);
}

function createMacHands({
  helper, apps, shell, fsp: files = fsp, spawn, home, runTimeoutMs = RUN_TIMEOUT_MS,
  sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }), now = Date.now,
}) {
  let map = null; // the last screenshot's { origin, pointsPerPixel }

  const relative = (s) => !path.isAbsolute(s) && s !== '~' && !s.startsWith('~/');
  /** A path as the AI wrote it: ~ is home; a relative one is in the home folder, or in `from`'s folder when given. */
  const resolvePath = (p, from = null) => {
    const s = String(p || '').trim();
    if (s === '~') return home;
    if (s.startsWith('~/')) return path.join(home, s.slice(2));
    if (path.isAbsolute(s)) return s;
    return from ? path.join(path.dirname(resolvePath(from)), s) : path.join(home, s);
  };

  /** The disk path with every link followed, also a dangling one (its target, even if missing); a missing tail is kept. */
  async function deepReal(q, hops = 0) {
    try { return await files.realpath(q); } catch (err) {
      if (err?.code !== 'ENOENT' && err?.code !== 'ENOTDIR') return q;
      let link = null;
      try { if ((await files.lstat(q)).isSymbolicLink()) link = await files.readlink(q); } catch { /* not a link */ }
      if (link !== null) {
        if (hops > 20) return q;
        return deepReal(path.resolve(path.dirname(q), link), hops + 1);
      }
      const up = path.dirname(q);
      if (up === q) return q;
      return path.join(await deepReal(up, hops + 1), path.basename(q));
    }
  }

  /** `real` is where the step acts; `view` is the same place as the safety core should see it ("~/…" in the real home, /tmp for the system's temp folders). */
  async function realOf(p, from = null) {
    const real = await deepReal(resolvePath(p, from));
    const realHome = await deepReal(home);
    let view = real;
    if (real === realHome) view = '~';
    else if (real.startsWith(`${realHome}/`)) view = `~/${real.slice(realHome.length + 1)}`;
    else if (/^\/private\/tmp(\/|$)/.test(real)) view = real.slice('/private'.length);
    else if (/^\/private\/var\/folders(\/|$)/.test(real)) view = `/tmp/var-folders${real.slice('/private/var/folders'.length)}`;
    return { real, view };
  }

  const FILE_KEYS = ['path', 'to'];
  /** The action with its file paths made real, the way act will use them: { view, real }. `view` is for riskOf. */
  async function resolveFiles(action) {
    const view = { ...action };
    const real = { ...action };
    if (action.type !== 'files' && action.type !== 'open_file') return { view, real };
    for (const key of FILE_KEYS) {
      if (typeof action[key] !== 'string') continue;
      const r = await realOf(action[key].trim(), key === 'to' && action.op === 'rename' ? action.path : null);
      view[key] = r.view;
      real[key] = r.real;
    }
    return { view, real };
  }

  /** The action as act will judge it: file paths resolved and real (see resolveFiles). The loop calls riskOf on this. */
  async function canonical(action) {
    return (await resolveFiles(action)).view;
  }

  /** The context shared/agent/safety.js's riskOf reads, from the last look: app, window title, dialog, line, target. */
  async function riskContext(action, observation, { risky = false } = {}) {
    const el = action.id ? (observation.elements || []).find((e) => e.id === action.id)
      : (action.type === 'click_at' ? await elementAt(action.x, action.y, observation) : null);
    const target = el ? { role: el.role, subrole: el.subrole || '', name: el.name || '', description: el.description || '' } : null;
    let overwrites = false;
    if (action.type === 'files' && ['copy', 'move', 'rename', 'write'].includes(action.op)) {
      const dest = action.op === 'write' ? action.path : action.to;
      overwrites = Boolean(dest) && await exists(dest, { from: action.op === 'rename' ? action.path : null });
    }
    return {
      app: observation.app, title: observation.window?.title || '', target, dialog: observation.dialog || '',
      line: observation.line || '', secure: observation.secureFocused === true, exists: overwrites, risky: risky === true,
    };
  }

  async function target() {
    return helper.lastApp || helper.call('frontmost');
  }

  async function observe({ screenshot = false } = {}) {
    const app = await target();
    const base = { app: { name: app?.name || '', id: app?.bundleId || '', pid: app?.pid || 0 }, window: { title: '' }, focused: null, secureFocused: false, elements: [], treeQuality: 'none', dialog: '' };
    if (!app?.pid || isPasswordApp(base.app)) return base;
    let tree;
    try {
      tree = await helper.call('axTree', { pid: app.pid, maxNodes: MAX_NODES });
    } catch (err) {
      if (STOPPERS.includes(err.code)) throw err;
      tree = { gen: 0, title: '', nodes: [], focused: null, secureFocused: false };
    }
    const elements = tree.nodes.map((n) => toElement(n, tree.focused));
    const named = elements.filter((e) => e.name).length;
    const dialogAt = elements.findIndex((e) => e.role === 'sheet' || e.role === 'dialog');
    const observation = {
      ...base,
      gen: tree.gen,
      window: { title: tree.title || '' },
      focused: tree.focused || null,
      secureFocused: tree.secureFocused === true,
      elements,
      treeQuality: named >= 5 ? 'good' : named > 0 ? 'poor' : 'none',
      truncated: tree.truncated === true,
      line: lastLine(elements.find((e) => e.id === tree.focused)),
      dialog: dialogAt >= 0 ? elements.slice(dialogAt, dialogAt + 12).map((e) => e.name).filter(Boolean).join(' ').slice(0, 300) : '',
    };
    if (screenshot && !observation.secureFocused) {
      const shot = await helper.call('screenshotScreen', { pid: app.pid, maxEdge: SHOT_EDGE });
      observation.screen = { image: shot.image, width: shot.width, height: shot.height };
      map = { origin: shot.origin, pointsPerPixel: shot.pointsPerPixel };
    }
    return observation;
  }

  const toPoints = (x, y) => ({ x: map.origin.x + x * map.pointsPerPixel, y: map.origin.y + y * map.pointsPerPixel });

  async function elementAt(x, y, observation) {
    if (!map) return null;
    const p = toPoints(x, y);
    const under = (observation.elements || []).filter((e) => e.frame && p.x >= e.frame.x && p.x < e.frame.x + e.frame.width && p.y >= e.frame.y && p.y < e.frame.y + e.frame.height);
    under.sort((a, b) => a.frame.width * a.frame.height - b.frame.width * b.frame.height);
    return under[0] || null;
  }

  async function waitForApp(name) {
    const until = now() + OPEN_WAIT_MS;
    while (now() < until) {
      if (helper.lastApp?.name === name) return;
      await sleep(200);
    }
  }

  /**
   * Runs a program in its own process group, no shell unless `file` is the shell itself. The job's `signal` and the
   * timeout kill the whole group (grandchildren too); it resolves on exit plus a short drain, never waiting on a pipe a
   * grandchild still holds.
   */
  function capture(file, args, { signal, lines = 0 } = {}) {
    return new Promise((resolve) => {
      let out = '';
      let done = false;
      let child = null;
      let exited = false;
      let timer = null;
      let drain = null;
      const killGroup = () => {
        if (!child?.pid || exited) return;
        try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } }
      };
      const text = () => {
        const t = lines ? out.split('\n').slice(0, lines).join('\n') : out;
        return t.slice(-RUN_OUTPUT);
      };
      const finish = (result) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        clearTimeout(drain);
        signal?.removeEventListener('abort', onAbort);
        killGroup();
        resolve(result);
      };
      const onAbort = () => finish(failed('stopped', 'Stopped.'));
      if (signal?.aborted) { resolve(failed('stopped', 'Stopped.')); return; }
      const env = { PATH: process.env.PATH, HOME: home, LANG: process.env.LANG || 'en_US.UTF-8', TERM: process.env.TERM || 'xterm-256color', USER: process.env.USER };
      try {
        child = spawn(file, args, { cwd: home, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (err) { resolve(failed('run_failed', err.message)); return; }
      signal?.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => finish(failed('timeout', 'It took too long, so I stopped it.')), runTimeoutMs);
      const take = (d) => { if (out.length < RUN_BUFFER) out += d; };
      child.stdout.on('data', take);
      child.stderr.on('data', take);
      child.on('error', (err) => finish(failed('run_failed', err.message)));
      const result = (code) => (code === 0
        ? { ok: true, note: 'done', output: text() }
        : { ok: false, code: 'exit', note: `exit code ${code}`, output: text() });
      child.on('exit', (code) => { exited = true; drain = setTimeout(() => finish(result(code)), DRAIN_MS); });
      child.on('close', (code) => finish(result(code)));
    });
  }
  const runCommand = (command, signal) => capture('/bin/zsh', ['-lc', command], { signal });

  /** `from`: for a rename, the file it renames, whose folder a relative new name is in. */
  async function exists(p, { from = null } = {}) {
    const s = String(p || '').trim();
    try { await files.lstat(resolvePath(s, from && relative(s) ? from : null)); return true; } catch { return false; }
  }

  async function filesAct(a, signal) {
    const p = resolvePath(a.path);
    // A rename's relative new name ("b.txt") is in the file's own folder; every other relative path is in the home folder.
    const to = a.to ? resolvePath(a.to, a.op === 'rename' ? a.path : null) : null;
    switch (a.op) {
      case 'list': {
        const names = (await files.readdir(p)).filter((n) => !n.startsWith('.')).sort();
        return { ok: true, note: `${names.length} items`, output: names.slice(0, LIST_MAX).join('\n') };
      }
      case 'find': {
        const query = String(a.text || path.basename(p));
        if (query.startsWith('-')) return failed('bad_query', 'That search word is not allowed.');
        const r = await capture('mdfind', ['-onlyin', p, '-name', query], { signal, lines: FIND_LINES });
        return r.ok ? { ok: true, note: 'found', output: r.output } : r;
      }
      case 'read': {
        const stat = await files.stat(p);
        if (stat.size > 1024 * 1024) return failed('too_big', 'That file is too big to read.');
        const text = await files.readFile(p, 'utf8');
        if (text.includes('\u0000')) return failed('binary', 'That is not a text file.');
        return { ok: true, note: `${text.length} characters`, output: text.slice(0, READ_MAX) };
      }
      case 'new_folder': await files.mkdir(p, { recursive: true }); return { ok: true };
      case 'copy': await files.cp(p, to, { recursive: true }); return { ok: true };
      case 'move':
      case 'rename': await files.rename(p, to); return { ok: true };
      case 'write': {
        // 'wx' for a new file: a link made since the check can never create a file somewhere else.
        const flag = (await files.lstat(p).then(() => true, () => false)) ? 'w' : 'wx';
        await files.writeFile(p, a.text || '', { flag });
        return { ok: true };
      }
      case 'trash': await shell.trashItem(p); return { ok: true };
      default: return failed('bad_op', `Unknown file op ${a.op}.`);
    }
  }

  async function doAct(a, o, signal) {
    const pid = o.app?.pid;
    const find = (id) => (o.elements || []).find((e) => e.id === id);
    const ax = (id, op, value) => helper.call('axAct', value === undefined ? { pid, gen: o.gen, id, op } : { pid, gen: o.gen, id, op, value });
    switch (a.type) {
      case 'open_app': {
        const found = apps.find(a.name);
        if (found.kind !== 'one') return failed('no_app', found.line);
        const problem = await apps.open(found.app.path);
        if (problem) return failed('open_failed', `I couldn't open ${found.app.name}.`);
        await waitForApp(found.app.name);
        return { ok: true, note: `opened ${found.app.name}` };
      }
      case 'open_url': {
        let scheme;
        try { scheme = new URL(a.url).protocol; } catch { return failed('bad_url', 'That is not a link.'); }
        if (!URL_SCHEMES.includes(scheme)) return failed('bad_url', 'I only open web, mail and call links.');
        await shell.openExternal(a.url);
        await sleep(SETTLE_MS * 3);
        return { ok: true };
      }
      case 'open_file': {
        const p = resolvePath(a.path);
        if (!(await exists(p))) return failed('no_file', `There is no ${a.path}.`);
        const problem = await shell.openPath(p);
        return problem ? failed('open_failed', problem) : { ok: true };
      }
      case 'open_settings': {
        if (!Object.hasOwn(SETTINGS_PAGES, a.page)) return failed('no_page', `Pages: ${Object.keys(SETTINGS_PAGES).join(', ')}.`);
        await shell.openExternal(`x-apple.systempreferences:${SETTINGS_PAGES[a.page]}`);
        await waitForApp('System Settings');
        return { ok: true };
      }
      case 'menu': await helper.call('menu', { pid, path: a.path }); return { ok: true };
      case 'keys': {
        const parts = String(a.combo || '').toLowerCase().split('+').map((x) => x.trim());
        if (!KEY_NAMES.includes(parts.at(-1)) || !parts.slice(0, -1).every((m) => KEY_MODIFIERS.includes(m))) return failed('bad_key', 'I do not know that key.');
        await helper.call('keys', { pid, combo: a.combo }); return { ok: true };
      }
      case 'type':
        if (a.id) await ax(a.id, 'focus');
        await helper.call('typeText', { pid, text: a.text });
        return { ok: true };
      case 'run': return runCommand(a.command, signal);
      case 'files': return filesAct(a, signal);
      case 'click': await ax(a.id, 'press'); return { ok: true };
      case 'set_value': await ax(a.id, 'setValue', a.text); return { ok: true };
      case 'toggle': await ax(a.id, 'toggle', a.on); return { ok: true };
      case 'pick': await ax(a.id, 'pick', a.option); return { ok: true };
      case 'focus': await ax(a.id, 'focus'); return { ok: true };
      case 'scroll': {
        const frame = (a.id && find(a.id)?.frame) || (o.elements || [])[0]?.frame;
        if (!frame) return failed('no_frame', 'I could not find where to scroll.');
        await helper.call('scroll', { ...centre(frame), dir: a.dir });
        return { ok: true };
      }
      case 'click_at':
        if (!map) return failed('no_screenshot', 'Needs a screenshot first.');
        await helper.call('click', { ...toPoints(a.x, a.y), right: a.right === true, count: a.double ? 2 : 1 });
        return { ok: true };
      case 'drag':
        if (!map) return failed('no_screenshot', 'Needs a screenshot first.');
        await helper.call('drag', { from: toPoints(a.from.x, a.from.y), to: toPoints(a.to.x, a.to.y) });
        return { ok: true };
      default:
        return failed('bad_action', `The Mac cannot do ${a.type}.`);
    }
  }

  /**
   * `signal`: the job's; a stop kills a command this act runs. `risky`: the AI's own flag for this step.
   * `approved`: the exact question the person said yes to (riskOf's `question`). act works out its own risk and goes on
   * only when it is safe, or an "ask" whose question equals `approved`; a "never" is always refused. Approval is for
   * one step and never carries over (`true` is not accepted).
   */
  async function act(action, observation, { signal, approved = null, risky = false } = {}) {
    if (isPasswordApp(observation.app)) return failed('password_app', "I don't touch password apps.");
    try {
      const { view, real } = await resolveFiles(action);
      const r = riskOf(view, await riskContext(real, observation, { risky }));
      if (r.risk === 'never') return failed('refused', `I won't do that: ${r.reason}.`);
      if (r.risk === 'ask' && (typeof approved !== 'string' || approved !== r.question)) {
        return { ok: false, code: 'needs_approval', note: `I need a yes first: ${r.question}`, question: r.question };
      }
      const result = await doAct(real, observation, signal);
      if (result.ok && !['run', 'files', 'open_app', 'open_settings', 'open_url'].includes(action.type)) await sleep(SETTLE_MS);
      return result;
    } catch (err) {
      if (STOPPERS.includes(err?.code)) throw err;
      if (err instanceof BuddyError) return failed(err.code, err.message || STEP_NOTES[err.code] || 'It did not work.');
      if (STEP_NOTES[err?.code]) return failed(err.code, STEP_NOTES[err.code]);
      return failed(err?.code || 'failed', err?.code === 'ENOENT' ? 'That file or folder is not there.' : 'It did not work.');
    }
  }

  return { observe, act, exists, elementAt, canonical, riskContext };
}

module.exports = { createMacHands, ROLE_NAMES, SETTINGS_PAGES };
