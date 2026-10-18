'use strict';

/**
 * Whether an agent step may run as it is, must be asked about first, or is never allowed (spec §7). The device decides
 * this before every act, whatever the AI said; the AI's own "risky" can only raise a step to "ask". The question asked
 * is written here, from the action and its target, never taken from the AI's words.
 */

const RISK_WORDS = [
  'send', 'post', 'publish', 'tweet', 'share', 'invite', 'submit', 'pay', 'pay now', 'buy', 'buy now', 'purchase',
  'place order', 'order now', 'confirm order', 'checkout', 'check out', 'subscribe', 'donate', 'transfer', 'confirm',
  'delete', 'remove', 'erase', 'trash', 'move to trash', 'move to bin', 'empty trash', 'empty bin', 'uninstall',
  'install', 'update now', 'restart', 'shut down', 'log out', 'sign out', 'reset', 'format', 'allow', 'unlock',
  'reply', 'place order', 'accept', 'agree', 'book', 'book now', 'reserve', 'discard', 'replace', 'unsubscribe',
  'bhejo', 'bhejein', 'bhej', 'bhej do', 'bhugtan', 'bhugtaan', 'hatao', 'hata do', 'mitao', 'mita do', 'delete karo',
  'kharido', 'pay karo', 'place your order', 'cannot be undone', "can't be undone", 'permanently', 'permanent', "don't save", 'dont save',
  'भेजें', 'भेजो', 'हटाएं', 'मिटाएं', 'खरीदें', 'भुगतान', 'पुष्टि करें', 'स्वीकार',
];
// Comfort settings (spec §15): no question. A name with one of these words anywhere, or exactly one of COMFORT_NAMES
// ("Focus" is one, "Focus status" is not), on a switch, checkbox, slider or radio, or picked in a pop-up.
const COMFORT_WORDS = ['volume', 'brightness', 'dark mode', 'light mode', 'do not disturb', 'wi fi', 'wifi', 'bluetooth'];
const COMFORT_NAMES = ['dark', 'light', 'auto', 'appearance', 'focus'];
const COMFORT_ROLES = ['switch', 'checkbox', 'slider', 'radio'];
const CHANGE_ROLES = ['checkbox', 'switch', 'radio', 'slider', 'popup', 'combobox', 'menuitem', 'button', 'textfield', 'incrementor'];
const BUTTON_ROLES = ['button', 'link', 'menuitem', 'menubutton'];
const SETTINGS_APPS = ['com.apple.systempreferences', 'com.apple.Settings'];
const INSTALL_APPS = ['com.apple.installer', 'com.apple.AppStore'];
const MESSAGING_APPS = [
  'com.apple.mail', 'com.apple.MobileSMS', 'net.whatsapp.WhatsApp', 'com.tinyspeck.slackmacgap', 'ru.keepcoder.Telegram',
  'com.hnc.Discord', 'com.microsoft.teams2', 'com.microsoft.Outlook', 'org.whispersystems.signal-desktop', 'com.facebook.archon',
  'com.tencent.xinWeChat', 'jp.naver.line.mac', 'com.viber.osx', 'com.skype.skype', 'us.zoom.xos',
];
const MESSAGING_NAMES = /^(wechat|line|viber|skype|zoom|zoom\.us|google chat)$/i;
const MESSAGING_TITLES = ['gmail', 'outlook', 'whatsapp', 'slack', 'telegram', 'discord', 'messenger', 'linkedin', 'twitter', 'instagram', 'facebook', 'teams', 'mail', 'wechat', 'viber', 'skype', 'zoom', 'google chat'];
const PAY_TITLES = ['bank', 'banking', 'checkout', 'payment', 'pay', 'upi', 'wallet', 'billing', 'card'];
const PASSWORD_APPS = ['com.1password.1password', 'com.agilebits.onepassword7', 'com.bitwarden.desktop', 'com.apple.keychainaccess', 'com.apple.Passwords', 'com.lastpass.LastPass', 'org.keepassxc.keepassxc'];
const PASSWORD_NAMES = /1password|bitwarden|keychain access|lastpass|dashlane|keepass|^passwords$/i;
const SECRET_PATHS = /(^|[/\s])(\.ssh|\.gnupg|\.aws|\.netrc|\.pgpass|\.git-credentials|\.npmrc|\.kube|\.buddy-release|\.claude|\.vercel|\.config\/gcloud|\.env(\.[\w-]+)?|id_rsa[\w.]*|id_ed25519[\w.]*|id_ecdsa[\w.]*|logins\.json|key4\.db)([/\s]|$)|\.docker\/config\.json|\.config\/gh\/hosts\.yml|keychains?|login data|web data|cookies/i;
const INSTALLER_FILES = /\.(pkg|mpkg|dmg|app|command|sh|tool|scpt|terminal|workflow|mobileconfig|prefpane|fileloc|webloc|jar|kext|scptd|inetloc|saver|qlgenerator|plugin|bundle)$/i;
const TERMINAL_APPS = [
  'com.apple.Terminal', 'com.googlecode.iterm2', 'dev.warp.Warp-Stable', 'dev.warp.Warp', 'com.apple.ScriptEditor2', 'com.mitchellh.ghostty',
  'net.kovidgoyal.kitty', 'com.microsoft.VSCode', 'com.todesktop.230313mzl4w4u92', 'org.alacritty', 'co.zeit.hyper', 'org.tabby',
  'com.github.wez.wezterm', 'com.apple.Automator', 'com.apple.shortcuts',
];
const TERMINAL_PREFIXES = ['com.jetbrains.'];
const TERMINAL_NAMES = /^(terminal|iterm2?|warp|script editor|ghostty|kitty|visual studio code|code|cursor|alacritty|hyper|tabby|wezterm|automator|shortcuts|intellij idea.*|pycharm.*|webstorm|goland|clion|rider|phpstorm|rubymine|datagrip|android studio)$/i;
// Every key name a step may press (the hands refuse any other); an unknown name asks.
const KEY_NAMES = Object.freeze([
  ...'abcdefghijklmnopqrstuvwxyz0123456789'.split(''), ...Array.from({ length: 20 }, (_, i) => `f${i + 1}`),
  'enter', 'return', 'kp_enter', 'tab', 'space', 'escape', 'esc', 'backspace', 'delete', 'up', 'down', 'left', 'right', 'home', 'end',
  'pageup', 'pagedown', 'page up', 'page down', '-', '=', '[', ']', '\\', ';', "'", ',', '.', '/', '`',
]);
const KEY_MODIFIERS = ['cmd', 'command', 'ctrl', 'control', 'alt', 'option', 'opt', 'shift', 'fn'];
const TERMINAL_KEYS = ['up', 'down', 'left', 'right', 'escape', 'esc', 'pageup', 'pagedown', 'page up', 'page down'];
const PASSWORD_PAGES = /bitwarden|1password|lastpass|dashlane|passwords\.google|google password manager|password manager/i;
const SAFE_TYPES = ['open_app', 'open_settings', 'look', 'scroll', 'focus', 'wait', 'handover', 'ask_user', 'done', 'stuck'];
const DOWNLOAD_LINKS = /\.(dmg|pkg|mpkg|exe|msi|apk|zip)(\?|#|$)/i;
const SAFE_SCHEMES = ['http:', 'https:', 'mailto:', 'x-apple.systempreferences:'];

const READ_ONLY_COMMANDS = ['ls', 'pwd', 'cat', 'head', 'tail', 'wc', 'echo', 'date', 'cal', 'which', 'whoami', 'df', 'du', 'uptime', 'mdfind', 'find', 'sw_vers', 'uname', 'file', 'stat', 'sort', 'grep', 'open'];
const NEVER_COMMANDS = [
  /\bsudo\b/, /\bdiskutil\s+(erase\w*|zero\w*|partition\w*|secureErase)\b/i, /\bcsrutil\b/, /\bspctl\s+--master-disable\b/,
  /\bmkfs\b/, /\bdd\s+[^|;]*\bof=\/dev\//, /\bnvram\b/, /\bfdesetup\s+disable\b/, /\bsecurity\s+(find|dump)-[\w-]*/, /\bsocketfilterfw\b[^\n]*--set\w+\s+(off|0|no)\b/i, /\bspctl\s+--global-disable\b/, /\bfdesetup\s+(disable|remove)\b/,
  /\brm\s+(-\w+\s+)*(\/|~\/?|\$HOME\/?)(\s|$)/, /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
];

// Case and Latin accents ignored, Devanagari kept; words are compared whole.
const LOOKALIKES = {
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', і: 'i', ј: 'j', ѕ: 's', ԁ: 'd', к: 'k', н: 'h', т: 't', в: 'b',
  α: 'a', ο: 'o', ν: 'v', ρ: 'p', ι: 'i', κ: 'k', τ: 't', υ: 'u', χ: 'x', ε: 'e',
};
const fold = (text) => String(text || '').normalize('NFKC').toLowerCase().replace(/[\u0370-\u03ff\u0400-\u04ff]/g, (ch) => LOOKALIKES[ch] || ch);
const mixedScript = (text) => /[a-z]/i.test(String(text || '')) && /[\u0370-\u03ff\u0400-\u04ff]/.test(String(text || ''));
const plain = (text) => ` ${fold(text).normalize('NFD').toLowerCase().replace(/[\u0300-\u036f]/g, '').replace(/[^\u0900-\u097Fa-z0-9]+/g, ' ').trim()} `;
const hasWord = (text, words) => { const p = plain(text); return words.some((w) => p.includes(plain(w))); };
const base = (path) => String(path).replace(/\/+$/, '').split('/').pop() || String(path);
const short = (text, max = 80) => (String(text).length > max ? `${String(text).slice(0, max - 1)}…` : String(text));
// The question is shown in the bubble (3 lines) and approves exactly what it says, so it must hold the whole thing.
const QUESTION_MAX = 110;
const fullAsk = (reason, text, make, what) => {
  const t = String(text);
  const q = make(t);
  if (/[\r\n]/.test(t) || q.length > QUESTION_MAX) return never(`That ${what} is too long for me to ask about. Run it yourself.`);
  return ask(reason, q);
};
const safe = () => ({ risk: 'safe', reason: '', question: '' });
const ask = (reason, question) => ({ risk: 'ask', reason, question });
const never = (reason) => ({ risk: 'never', reason, question: '' });

function isPasswordApp(app) {
  return Boolean(app) && (PASSWORD_APPS.includes(app.id) || PASSWORD_NAMES.test(app.name || ''));
}

const unquote = (text) => String(text).replace(/["'\\]/g, '');

/** A path made comparable: lower case, "~" and /Users/<name> become "~", "." and ".." resolved. Relative paths: null. */
function normPath(path) {
  let p = String(path || '').trim().toLowerCase();
  p = p.replace(/^\/system\/volumes\/data(?=\/|$)/, '').replace(/^\/volumes\/macintosh hd(?=\/|$)/, '');
  if (p === '~' || p.startsWith('~/')) p = `/users/~${p.slice(1)}`;
  if (p === '') p = '/';
  if (!p.startsWith('/')) return null;
  const out = [];
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') out.pop(); else out.push(seg);
  }
  const full = `/${out.join('/')}`;
  const home = /^\/users\/[^/]+(\/.*)?$/.exec(full);
  return home ? `~${home[1] || ''}` : full;
}
/** Any part starting with "." (raw or resolved), or anything under ~/Library: reading or writing it asks. */
function hiddenPath(path) {
  const dotted = (p) => String(p || '').split('/').some((seg) => seg.startsWith('.') && seg !== '.' && seg !== '..');
  const n = normPath(path);
  return dotted(unquote(path)) || dotted(n) || Boolean(n && /^~\/library(\/|$)/.test(n));
}
const isSecretPath = (path) => SECRET_PATHS.test(unquote(path)) || SECRET_PATHS.test(normPath(path) || '');

const webLink = (arg) => /^https?:\/\/[^\s'"]+$/i.test(arg);
const PATH_WORD = /^[\w@%+,.:/~ -]+$/;
const PLAIN_WORD = /^[\w .,:@%+-]+$/;
const GLOB = /[*?[\]]/;

/** Splits a command into its parts (at ; & | and line breaks) and words; null when a quote is not closed. */
function splitParts(command) {
  const parts = [];
  let words = [];
  let word = null;
  let quote = '';
  const endWord = () => { if (word) words.push(word); word = null; };
  const endPart = () => { endWord(); if (words.length) parts.push(words); words = []; };
  for (const ch of command) {
    if (quote) {
      if (ch === quote) quote = ''; else word.text += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; word = word || { text: '', quoted: false }; word.quoted = true; continue; }
    if (ch === ' ' || ch === '\t') { endWord(); continue; }
    if (';&|\n\r'.includes(ch)) { endPart(); continue; }
    word = word || { text: '', quoted: false };
    word.text += ch;
  }
  if (quote) return null;
  endPart();
  return parts;
}

const FLAG_CMDS = {
  pwd: { f: 'LP' }, date: { f: 'u' }, whoami: { f: '' }, uptime: { f: '' }, sw_vers: { f: '' }, uname: { f: 'amnrsvp' }, cal: { f: '' },
  df: { f: 'hHkTi', paths: true }, ls: { f: 'lahARtrS1dFGi@', paths: true }, du: { f: 'shkcaxH', paths: true },
  wc: { f: 'lwcm', paths: true }, cat: { f: 'n', paths: true }, sort: { f: 'hnruf', paths: true },
  stat: { f: '', paths: true }, file: { f: '', paths: true },
  which: { f: 'a', words: true }, echo: { f: 'n', words: true },
  head: { f: '', num: true, paths: true }, tail: { f: '', num: true, paths: true },
};

/** Why a read-only command's words are not provably plain and read-only, or '' when they are. */
function checkArgs(cmd, args) {
  const spec = FLAG_CMDS[cmd];
  const bad = (why = 'the command can change things') => why;
  if (args.some((w) => !w.quoted && GLOB.test(w.text))) return bad('it reads many files at once');
  if (spec) {
    for (let i = 0; i < args.length; i += 1) {
      const w = args[i].text;
      if (/^-[A-Za-z0-9@]+$/.test(w) && !args[i].quoted) {
        if (spec.num && w === '-n' && /^\d+$/.test(args[i + 1]?.text || '')) { i += 1; continue; }
        const ok = [...w.slice(1)].every((ch) => spec.f.includes(ch) || (spec.num && /\d/.test(ch)));
        if (!ok) return bad();
      } else if (w.startsWith('-')) {
        return bad();
      } else if (spec.paths) {
        if (!PATH_WORD.test(w) || (w.includes(' ') && !args[i].quoted)) return bad();
      } else if (!PLAIN_WORD.test(w)) {
        return bad();
      }
    }
    return '';
  }
  if (cmd === 'mdfind') {
    for (let i = 0; i < args.length; i += 1) {
      const w = args[i].text;
      if (w === '-name' || w === '-onlyin') { i += 1; if (!args[i] || !PATH_WORD.test(args[i].text)) return bad(); } else if (w.startsWith('-') || !PLAIN_WORD.test(w)) return bad();
    }
    return '';
  }
  if (cmd === 'find') {
    let i = 0;
    while (i < args.length && !args[i].text.startsWith('-')) { if (!PATH_WORD.test(args[i].text)) return bad(); i += 1; }
    for (; i < args.length; i += 1) {
      const w = args[i].text;
      const v = args[i + 1];
      if (w === '-name' || w === '-iname') { if (!v || !/^[\w .*\-_]+$/.test(v.text)) return bad('find can change files'); i += 1; } else if (w === '-type') { if (!v || !/^[fd]$/.test(v.text)) return bad(); i += 1; } else if (w === '-maxdepth' || w === '-mindepth') { if (!v || !/^\d+$/.test(v.text)) return bad(); i += 1; } else if (w !== '-print') return bad('find can change files');
    }
    return '';
  }
  if (cmd === 'grep') {
    let pattern = false;
    for (const a of args) {
      const w = a.text;
      if (!pattern && /^-[A-Za-z]+$/.test(w) && !a.quoted) { if (![...w.slice(1)].every((ch) => 'inwvcloEFhHq'.includes(ch))) return bad('it reads many files at once'); } else if (!pattern) { if (w.startsWith('-') || !PLAIN_WORD.test(w)) return bad(); pattern = true; } else if (w.startsWith('-') || !PATH_WORD.test(w)) return bad();
    }
    return '';
  }
  if (cmd === 'open') {
    if (!args.length) return bad('open can start apps, calls or installers');
    const urls = args.every((a) => webLink(a.text));
    if (urls) {
      for (const a of args) {
        try { const u = new URL(a.text); if (DOWNLOAD_LINKS.test(u.pathname) || INSTALLER_FILES.test(u.pathname) || PASSWORD_PAGES.test(u.hostname)) return bad('it downloads an installer'); } catch { return bad(); }
      }
      return '';
    }
    return bad('open can start apps, calls or installers');
  }
  return bad();
}

/** The words of a read-only command that are file paths (not flags, numbers or search words). */
function relativeArgs(cmd, args) {
  const texts = args.map((a) => a.text);
  const isPath = (w) => !w.startsWith('-') && !/^https?:/i.test(w) && !/^\d+$/.test(w);
  if (FLAG_CMDS[cmd]?.paths) return texts.filter(isPath);
  if (cmd === 'find') { const i = texts.findIndex((w) => w.startsWith('-')); return (i < 0 ? texts : texts.slice(0, i)); }
  if (cmd === 'grep') { const rest = texts.filter((w) => !w.startsWith('-')); return rest.slice(1); }
  return [];
}

/**
 * A shell command (spec §7.2(1)): an allow-list. Safe only when the whole command is plain words (no $ { } ` \ < > ( ),
 * no unquoted wildcards or "X=" assignments), split on ; && || | |& & and line breaks into parts that are each one of a
 * few read-only commands with only their known flags and plain path arguments (`open` only with web links or one
 * folder). Anything else asks. Never: harmful commands, and any command that names a file with keys or passwords.
 */
function commandRisk(command) {
  const c = String(command || '');
  if (NEVER_COMMANDS.some((re) => re.test(c))) return { risk: 'never', reason: 'that command could harm the computer or show passwords' };
  if (SECRET_PATHS.test(unquote(c).toLowerCase())) return { risk: 'never', reason: 'that file holds keys or passwords' };
  const complex = { risk: 'ask', reason: 'the command can change things' };
  if (/[$`{}\\<>()]/.test(c)) return complex;
  const parts = splitParts(c);
  if (!parts) return complex;
  for (const words of parts) {
    const [first, ...args] = words;
    if (first.quoted || !/^[a-z_]+$/.test(first.text) || !(Object.hasOwn(FLAG_CMDS, first.text) || ['mdfind', 'find', 'grep', 'open'].includes(first.text))) return complex;
    const why = checkArgs(first.text, args);
    if (why) return { risk: 'ask', reason: why };
    if (relativeArgs(first.text, args).some((a) => relative(a))) return { risk: 'ask', reason: 'it uses a path I cannot check' };
    if (args.some((a) => !a.text.startsWith('-') && !/^https?:/i.test(a.text) && hiddenPath(a.text))) return { risk: 'ask', reason: 'it looks in a hidden or system folder' };
  }
  return { risk: 'safe', reason: '' };
}

function messaging(c) {
  return MESSAGING_APPS.includes(c.app?.id) || MESSAGING_NAMES.test(c.app?.name || '') || hasWord(c.title, MESSAGING_TITLES);
}

const inSettings = (c) => SETTINGS_APPS.includes(c.app?.id);
const inTerminal = (c) => (Boolean(c.app) && (TERMINAL_APPS.includes(c.app.id) || TERMINAL_PREFIXES.some((x) => String(c.app.id || '').startsWith(x)) || TERMINAL_NAMES.test(c.app.name || '')))
  || /terminal/i.test(`${c.target?.role || ''} ${c.target?.subrole || ''} ${c.target?.description || ''}`);

/** A comfort setting (spec §15): the right kind of control, a comfort name, and no risk word ("Reset Bluetooth…" asks). */
function comfortSetting(action, name, role) {
  if (!COMFORT_ROLES.includes(role) && action.type !== 'pick') return false;
  if (hasWord(name, RISK_WORDS)) return false;
  return hasWord(name, COMFORT_WORDS) || COMFORT_NAMES.includes(plain(name).trim());
}

/** Things the owner never lets Buddy do in Settings (spec §7.1, §7.4). */
function settingsNever(action, name) {
  const p = plain(name);
  if (/ buddy /.test(p)) return never("I don't change my own permissions");
  if (/ firewall /.test(p)) return never("I don't change the firewall");
  if (/ file ?vault /.test(p) && (action.on === false || / turn off /.test(p))) return never("I don't turn off FileVault");
  if (/ gatekeeper | anywhere /.test(p)) return never("I don't change what apps may open");
  return null;
}

/**
 * The risk of one acting step on an element (a click, toggle, pick, set_value, type, Enter or Space): words, then
 * context. In a settings app every change asks except a comfort setting and typing in its search field.
 */
function elementRisk(action, c, target) {
  const app = c.app?.name || 'this app';
  const name = target?.name || '';
  const role = target?.role || '';
  if (inSettings(c)) {
    const n = settingsNever(action, name);
    if (n) return n;
  }
  if (mixedScript(name) || mixedScript(action.option)) return ask('the label mixes alphabets', `Click "${short(name || action.option)}" in ${app}?`);
  if (name && hasWord(name, RISK_WORDS)) return ask(`"${name}" can't be undone`, `Click "${short(name)}" in ${app}?`);
  if (action.type === 'pick' && action.option && hasWord(action.option, RISK_WORDS)) {
    return ask(`"${action.option}" can't be undone`, `Pick "${short(action.option)}" in ${app}?`);
  }
  if (messaging(c) && BUTTON_ROLES.includes(role) && !name.trim()) return ask('this button has no name', `Click a button with no name in ${app}?`);
  if (inSettings(c) && action.type !== 'focus') {
    if (comfortSetting(action, name, role)) return safe();
    const typing = action.type === 'type' || action.type === 'set_value';
    if (typing && role === 'searchfield') return safe(); // searching in Settings changes nothing
    if (!target || typing || CHANGE_ROLES.includes(role)) {
      return ask('a system setting changes', `Change "${short(name || 'this setting')}" in System Settings?`);
    }
  }
  if (INSTALL_APPS.includes(c.app?.id) && BUTTON_ROLES.includes(role)) {
    return ask('it installs or buys', `Click "${short(name || 'this')}" in ${app}?`);
  }
  if (hasWord(c.title, PAY_TITLES) && BUTTON_ROLES.includes(role)) {
    return ask('this page handles money', `Click "${short(name || 'this')}" on this payment page?`);
  }
  return safe();
}

const underHome = (n) => n === '~' || n.startsWith('~/');
const SYSTEM_DIRS = /^\/(system|library|applications|usr|bin|sbin|etc|private|var|opt)(\/|$)/;

/** Where a file would be written: dotfiles and ~/Library run code at login, system folders change the Mac, relative paths are unknown. */
function writeTargetRisk(path) {
  const n = normPath(path);
  if (n === null) return ask('it is not clear where this goes', `Change files in ${short(path)}?`);
  if (SYSTEM_DIRS.test(n)) return ask('it changes system folders', `Change files in ${short(path)}?`);
  if (underHome(n) && (/^~\/library(\/|$)/.test(n) || /^~\/\.[^/]/.test(n))) return ask('it can run code at login', `Change files in ${short(path)}?`);
  return null;
}

const relative = (p) => normPath(p) === null;

function filesRisk(action, c) {
  for (const p of [action.path, action.to]) {
    if (p && isSecretPath(p)) return never('that file holds keys or passwords');
  }
  for (const p of [action.path, action.to]) {
    if (p && relative(p)) return ask('it is not clear where this is', `Use "${short(p)}"?`);
    if (p && hiddenPath(p)) return ask('it is a hidden or system folder', `Use "${short(p)}"?`);
  }
  if (action.op === 'trash') return ask('it deletes', `Move "${base(action.path)}" to the Trash?`);
  const writes = ['copy', 'move', 'rename', 'write', 'new_folder'].includes(action.op);
  if (writes) {
    for (const p of [action.path, action.to]) {
      const r = p ? writeTargetRisk(p) : null;
      if (r) return r;
    }
  }
  if (['copy', 'move', 'rename'].includes(action.op) && c.exists) return ask('it replaces a file', `Replace "${base(action.to || '')}"?`);
  if (action.op === 'write' && c.exists) return ask('it replaces a file', `Replace "${base(action.path)}"?`);
  if (['copy', 'move'].includes(action.op) && action.to) {
    const to = normPath(action.to);
    if (to && !underHome(to)) return ask('it leaves your home folder', `Put "${base(action.path)}" outside your home folder?`);
  }
  return safe();
}

function urlRisk(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return never('that is not a link'); }
  if (parsed.protocol === 'javascript:' || parsed.protocol === 'data:' || parsed.protocol === 'file:') return never('that kind of link is not allowed');
  if (PASSWORD_PAGES.test(parsed.hostname)) return never("I don't open password manager pages");
  if (parsed.protocol === 'tel:' || parsed.protocol === 'facetime:' || parsed.protocol === 'facetime-audio:') return ask('it calls', `Call ${short(decodeURIComponent(parsed.pathname))}?`);
  if (parsed.protocol === 'sms:') return ask('it texts', `Text ${short(decodeURIComponent(parsed.pathname))}?`);
  if (!SAFE_SCHEMES.includes(parsed.protocol)) return fullAsk('it opens another app', url, (t) => `Open this link: ${t}?`, 'link');
  if (/download/i.test(parsed.search) || DOWNLOAD_LINKS.test(parsed.pathname) || INSTALLER_FILES.test(parsed.pathname)) return ask('it downloads an installer', `Download ${short(base(parsed.pathname))}?`);
  return safe();
}

function keysRisk(action, c) {
  const parts = action.combo.toLowerCase().split('+').map((p) => p.trim());
  const key = parts.at(-1);
  const mods = parts.slice(0, -1);
  if (!KEY_NAMES.includes(key) || !mods.every((m) => KEY_MODIFIERS.includes(m))) return ask('that key is not known', `Press ${short(action.combo)} in ${c.app?.name || 'this app'}?`);
  const enter = key === 'enter' || key === 'return' || key === 'kp_enter' || (mods.includes('ctrl') && (key === 'j' || key === 'm'));
  const app = c.app?.name || 'this app';
  if (enter && messaging(c)) return ask('it sends', `Send this in ${app}?`);
  if (inTerminal(c)) {
    if (enter) return c.line ? fullAsk('it runs a command', c.line, (t) => `Run "${t}" in ${app}?`, 'command') : ask('it runs a command', `Run this in ${app}?`);
    if (!TERMINAL_KEYS.includes(key)) return ask('keys in a terminal can run things', `Press ${short(action.combo)} in ${app}?`);
  }
  if ((key === 'backspace' || key === 'delete') && mods.includes('cmd')) return ask('it deletes', 'Move the selected items to the Trash?');
  if ((enter || key === 'space') && c.dialog) return ask('a dialog is open', 'Answer the dialog?');
  if (enter || key === 'space') {
    if (c.target || inSettings(c)) return elementRisk(action, c, c.target);
  }
  return safe();
}

function typedRisk(action, c) {
  if (inTerminal(c)) {
    const r = commandRisk(action.text);
    if (r.risk === 'never') return never(r.reason);
    return r.risk === 'ask' ? fullAsk(r.reason, action.text, (t) => `Type this command: ${t}?`, 'command') : safe();
  }
  if (messaging(c) && /[\r\n]/.test(action.text || '')) return ask('it sends', `Send this in ${c.app?.name || 'this app'}?`);
  return null;
}

const ACTING = ['click', 'toggle', 'pick', 'click_at', 'keys', 'type', 'set_value', 'drag', 'menu'];

function baseRisk(action, c) {
  if (isPasswordApp(c.app)) return never("I don't touch password apps");
  if (ACTING.includes(action.type) && PASSWORD_PAGES.test(c.title)) return never("I don't touch password manager pages");
  const target = c.target;
  switch (action.type) {
    case 'type':
    case 'set_value': {
      if (target?.role === 'password-field' || (!action.id && c.secure)) return never("I don't type into password fields");
      const t = typedRisk(action, c);
      if (t) return t;
      return inSettings(c) ? elementRisk(action, c, target) : safe(); // spec §7.2(3): a settings change asks
    }
    case 'click':
    case 'toggle':
    case 'pick':
      return elementRisk(action, c, target);
    case 'click_at':
      if (target) return elementRisk(action, c, target);
      if (c.dialog) return ask('a dialog is open', 'Click there in the dialog?');
      return inSettings(c) ? ask('a system setting may change', 'Click there in System Settings?') : safe();
    case 'drag':
      return hasWord(`${target?.name || ''} ${c.title}`, ['trash', 'bin']) ? ask('it deletes', 'Drag it to the Trash?') : safe();
    case 'keys':
      if (c.secure) return never("I don't type into password fields");
      return keysRisk(action, c);
    case 'menu': {
      const last = action.path.at(-1);
      return hasWord(last, RISK_WORDS) ? ask(`"${last}" can't be undone`, `Use "${short(last)}" in ${c.app?.name || 'this app'}?`) : safe();
    }
    case 'run': {
      const r = commandRisk(action.command);
      if (r.risk === 'never') return never(r.reason);
      return r.risk === 'ask' ? fullAsk(r.reason, action.command, (t) => `Run this command: ${t}?`, 'command') : safe();
    }
    case 'files': return filesRisk(action, c);
    case 'open_url': return urlRisk(action.url);
    case 'open_file': {
      const clean = String(action.path).replace(/\/+$/, '');
      if (isSecretPath(clean)) return never('that file holds keys or passwords');
      if (INSTALLER_FILES.test(clean)) return ask('it can install or run things', `Open "${base(clean)}"? It can install or run things.`);
      if (!/\.[A-Za-z0-9]{1,8}$/.test(base(clean))) return ask('it may be a program', `Open "${base(clean)}"? It may be a program.`);
      return safe();
    }
    default:
      return SAFE_TYPES.includes(action.type) ? safe() : ask('this step is new to me', 'Go ahead with this step?');
  }
}

const CONTEXT_CHECKED = ['click', 'toggle', 'pick', 'click_at'];

function riskOf(action, ctx = {}) {
  const c = { app: null, title: '', target: null, dialog: '', exists: false, secure: false, risky: false, ...ctx };
  const r = baseRisk(action, c);
  if (r.risk === 'safe') {
    const key = action.type === 'keys' ? action.combo.toLowerCase().split('+').pop().trim() : '';
    const keyAct = ['enter', 'return', 'kp_enter', 'space'].includes(key) || (action.type === 'keys' && /ctrl\+[jm]$/i.test(action.combo));
    if ((CONTEXT_CHECKED.includes(action.type) || keyAct) && (hasWord(c.dialog, RISK_WORDS) || hasWord(c.title, RISK_WORDS))) {
      return ask('the window mentions something risky', `Go ahead in ${c.app?.name || 'this app'}?`);
    }
    if (c.risky) return ask('the AI thinks it is risky', 'This step may be risky. Go ahead?');
  }
  return r;
}

module.exports = { PASSWORD_APPS, KEY_NAMES, KEY_MODIFIERS, riskOf, commandRisk, isPasswordApp, RISK_WORDS, COMFORT_WORDS, COMFORT_NAMES, COMFORT_ROLES, READ_ONLY_COMMANDS };
