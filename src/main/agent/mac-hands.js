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
const OPEN_SCHEMES = ['http:', 'https:', 'mailto:', 'tel:', 'sms:', 'facetime:', 'facetime-audio:', 'x-apple.systempreferences:'];

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
  helper, apps, shell, fsp: files = fsp, spawn, home,
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

  /** The real place of a path: symlinks resolved, a not-yet-existing tail kept; a path in the real home folder is "~/…". */
  async function realOf(p) {
    const deep = async (q) => {
      try { return await files.realpath(q); } catch (err) {
        const up = path.dirname(q);
        if (err?.code !== 'ENOENT' || up === q) return q;
        return path.join(await deep(up), path.basename(q));
      }
    };
    const real = await deep(resolvePath(p));
    const realHome = await deep(home);
    if (real === realHome) return '~';
    return real.startsWith(`${realHome}/`) ? `~/${real.slice(realHome.length + 1)}` : real;
  }

  /**
   * The action with its file paths made real (symlinks and other disk names resolved), for the safety check. A relative
   * path is left as it is: the core asks about those. The loop calls riskOf on this, not on what the AI wrote.
   */
  async function canonical(action) {
    if (action.type !== 'files' && action.type !== 'open_file') return action;
    const out = { ...action };
    for (const key of ['path', 'to']) {
      if (typeof out[key] === 'string' && !relative(out[key].trim())) out[key] = await realOf(out[key]);
    }
    return out;
  }

  /** The context shared/agent/safety.js's riskOf reads, from the last look: app, window title, dialog, line, target. */
  async function riskContext(action, observation, { exists = false } = {}) {
    const el = action.id ? (observation.elements || []).find((e) => e.id === action.id)
      : (action.type === 'click_at' ? await elementAt(action.x, action.y, observation) : null);
    const target = el ? { role: el.role, subrole: el.subrole || '', name: el.name || '', description: el.description || '' } : null;
    return {
      app: observation.app, title: observation.window?.title || '', target, dialog: observation.dialog || '',
      line: observation.line || '', secure: observation.secureFocused === true, exists,
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

  /** A shell command in the home folder. The job's `signal` kills it (spawn's own abort), so Stop never waits for it. */
  function runCommand(command, signal) {
    return new Promise((resolve) => {
      let out = '';
      const stopped = () => failed('stopped', 'Stopped.');
      if (signal?.aborted) { resolve(stopped()); return; }
      const child = spawn('/bin/zsh', ['-lc', command], { cwd: home, env: process.env, timeout: RUN_TIMEOUT_MS, signal });
      const take = (d) => { if (out.length < RUN_BUFFER) out += d; };
      child.stdout.on('data', take);
      child.stderr.on('data', take);
      child.on('error', (err) => resolve(err.name === 'AbortError' ? stopped() : failed('run_failed', err.message)));
      child.on('close', (code) => {
        if (signal?.aborted) { resolve(stopped()); return; }
        resolve(code === 0
          ? { ok: true, note: 'done', output: out.slice(-RUN_OUTPUT) }
          : { ok: false, code: 'exit', note: `exit code ${code}`, output: out.slice(-RUN_OUTPUT) });
      });
    });
  }

  /** `from`: for a rename, the file it renames, whose folder a relative new name is in. */
  async function exists(p, { from = null } = {}) {
    const s = String(p || '').trim();
    try { await files.stat(resolvePath(s, from && relative(s) ? from : null)); return true; } catch { return false; }
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
        const r = await runCommand(`mdfind -onlyin ${JSON.stringify(p)} -name ${JSON.stringify(a.text || path.basename(p))} | head -30`, signal);
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
      case 'write': await files.writeFile(p, a.text || ''); return { ok: true };
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
        if (!OPEN_SCHEMES.includes(scheme) && !/^[a-z][a-z0-9+.-]*:$/.test(scheme)) return failed('bad_url', 'That is not a link.');
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

  /** `signal`: the job's; a stop kills a command this act runs. */
  async function act(action, observation, { signal } = {}) {
    if (isPasswordApp(observation.app)) return failed('password_app', "I don't touch password apps.");
    try {
      if (action.type === 'files' || action.type === 'open_file') {
        // Realpath before acting: a link into a place the core would ask about or refuse is not followed.
        const real = await canonical(action);
        const ctx = { app: observation.app };
        const was = riskOf(action, ctx).risk;
        const now = riskOf(real, ctx).risk;
        if (now === 'never' || (now === 'ask' && was === 'safe')) return failed('path_changed', 'That path leads somewhere else, so I stopped.');
      }
      const result = await doAct(action, observation, signal);
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
