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
  'bhejo', 'bhejein', 'bhugtan', 'bhugtaan', 'hatao', 'mitao', 'kharido',
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
];
const MESSAGING_TITLES = ['gmail', 'outlook', 'whatsapp', 'slack', 'telegram', 'discord', 'messenger', 'linkedin', 'twitter', 'instagram', 'facebook', 'teams', 'mail'];
const PAY_TITLES = ['bank', 'banking', 'checkout', 'payment', 'pay', 'upi', 'wallet', 'billing', 'card'];
const PASSWORD_APPS = ['com.1password.1password', 'com.agilebits.onepassword7', 'com.bitwarden.desktop', 'com.apple.keychainaccess', 'com.apple.Passwords', 'com.lastpass.LastPass', 'org.keepassxc.keepassxc'];
const PASSWORD_NAMES = /1password|bitwarden|keychain access|lastpass|dashlane|keepass|^passwords$/i;
const SECRET_PATHS = /(^|[/\s])(\.ssh|\.gnupg|\.aws|\.netrc|\.env(\.[\w-]+)?|id_rsa[\w.]*|id_ed25519[\w.]*)([/\s]|$)|keychain|login data|cookies/i;
const INSTALLER_FILES = /\.(pkg|mpkg|dmg|app|command|sh|terminal)$/i;
const DOWNLOAD_LINKS = /\.(dmg|pkg|mpkg|exe|msi|apk|zip)(\?|#|$)/i;
const SAFE_SCHEMES = ['http:', 'https:', 'mailto:', 'x-apple.systempreferences:'];

const READ_ONLY_COMMANDS = ['ls', 'pwd', 'cat', 'head', 'tail', 'wc', 'echo', 'date', 'cal', 'which', 'whoami', 'df', 'du', 'uptime', 'mdfind', 'find', 'sw_vers', 'uname', 'file', 'stat', 'sort', 'grep', 'open'];
const CONTENT_COMMANDS = ['cat', 'head', 'tail', 'grep', 'sort']; // they print what is inside files
const NEVER_COMMANDS = [
  /\bsudo\b/, /\bdiskutil\s+(erase\w*|zero\w*|partition\w*|secureErase)\b/i, /\bcsrutil\b/, /\bspctl\s+--master-disable\b/,
  /\bmkfs\b/, /\bdd\s+[^|;]*\bof=\/dev\//, /\bnvram\b/, /\bfdesetup\s+disable\b/, /\bsecurity\s+(find|dump)-[\w-]*/,
  /\brm\s+(-\w+\s+)*(\/|~\/?|\$HOME\/?)(\s|$)/, /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
];

const plain = (text) => ` ${String(text || '').toLowerCase().replace(/[^\u0900-\u097Fa-z0-9]+/g, ' ').trim()} `; // Devanagari kept
const hasWord = (text, words) => { const p = plain(text); return words.some((w) => p.includes(` ${w} `)); };
const base = (path) => String(path).replace(/\/+$/, '').split('/').pop() || String(path);
const short = (text, max = 80) => (String(text).length > max ? `${String(text).slice(0, max - 1)}…` : String(text));
const safe = () => ({ risk: 'safe', reason: '', question: '' });
const ask = (reason, question) => ({ risk: 'ask', reason, question });
const never = (reason) => ({ risk: 'never', reason, question: '' });

function isPasswordApp(app) {
  return Boolean(app) && (PASSWORD_APPS.includes(app.id) || PASSWORD_NAMES.test(app.name || ''));
}

const unquote = (text) => String(text).replace(/["'\\]/g, '');
const webLink = (arg) => /^https?:\/\/\S+$/i.test(arg);
// A folder: no flag, no scheme (tel:, slack://) and no file extension (.pdf, .pkg): "~/Downloads", ".".
const folderLike = (arg) => !arg.startsWith('-') && !/^[a-z][a-z0-9+.-]*:/i.test(arg) && !/\.[A-Za-z0-9]{1,8}$/.test(arg.replace(/\/+$/, ''));

/**
 * A shell command (spec §7.2(1)): safe only when every part of it, split on ; && || | |& & and line breaks, is a
 * read-only command. A command that names a file with keys or passwords is never run, even `cat`; a recursive grep or a
 * wildcard read asks (it reads many files); `open` is safe only with web links or one folder.
 */
function commandRisk(command) {
  const c = String(command || '');
  if (NEVER_COMMANDS.some((re) => re.test(c))) return { risk: 'never', reason: 'that command could harm the computer or show passwords' };
  if (SECRET_PATHS.test(unquote(c))) return { risk: 'never', reason: 'that file holds keys or passwords' };
  if (/`|\$\(|>|<\(/.test(c)) return { risk: 'ask', reason: 'the command writes files or runs another command' };
  for (const part of c.split(/&&|\|\||\|&|[;|&\n]/)) {
    const words = part.trim().split(/\s+/).filter((w) => w && !/^\w+=/.test(w)).map(unquote);
    if (!words.length) continue;
    const [cmd, ...args] = words;
    if (!READ_ONLY_COMMANDS.includes(cmd)) return { risk: 'ask', reason: 'the command can change things' };
    if (cmd === 'find' && args.some((a) => ['-delete', '-exec', '-execdir', '-ok'].includes(a))) return { risk: 'ask', reason: 'find can change files' };
    if (CONTENT_COMMANDS.includes(cmd) && args.some((a) => /[*?[]/.test(a))) return { risk: 'ask', reason: 'it reads many files at once' };
    if (cmd === 'grep' && args.some((a) => a === '--recursive' || /^-[a-zA-Z]*[rR]/.test(a))) return { risk: 'ask', reason: 'it reads many files at once' };
    if (cmd === 'open' && !(args.length && (args.every(webLink) || (args.length === 1 && folderLike(args[0]))))) {
      return { risk: 'ask', reason: 'open can start apps, calls or installers' };
    }
  }
  return { risk: 'safe', reason: '' };
}

function messaging(c) {
  return MESSAGING_APPS.includes(c.app?.id) || hasWord(c.title, MESSAGING_TITLES);
}

const inSettings = (c) => SETTINGS_APPS.includes(c.app?.id);

/** A comfort setting (spec §15): the right kind of control, a comfort name, and no risk word ("Reset Bluetooth…" asks). */
function comfortSetting(action, name, role) {
  if (!COMFORT_ROLES.includes(role) && action.type !== 'pick') return false;
  if (hasWord(name, RISK_WORDS)) return false;
  return hasWord(name, COMFORT_WORDS) || COMFORT_NAMES.includes(plain(name).trim());
}

/**
 * The risk of one acting step on an element (a click, toggle, pick, set_value, type, Enter or Space): words, then
 * context. In a settings app every change asks except a comfort setting and typing in its search field.
 */
function elementRisk(action, c, target) {
  const app = c.app?.name || 'this app';
  const name = target?.name || '';
  const role = target?.role || '';
  if (name && hasWord(name, RISK_WORDS)) return ask(`"${name}" can't be undone`, `Click "${short(name)}" in ${app}?`);
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

function filesRisk(action, c) {
  if (action.op === 'read' && SECRET_PATHS.test(action.path)) return never('that file holds keys or passwords');
  if (action.op === 'trash') return ask('it deletes', `Move "${base(action.path)}" to the Trash?`);
  if (['copy', 'move', 'rename'].includes(action.op) && c.exists) return ask('it replaces a file', `Replace "${base(action.to || '')}"?`);
  if (action.op === 'write' && c.exists) return ask('it replaces a file', `Replace "${base(action.path)}"?`);
  if (['copy', 'move', 'rename', 'write', 'new_folder'].includes(action.op) && /^\/(System|Library|Applications|usr|bin|sbin|etc|private)\b/.test(action.to || action.path)) {
    return ask('it changes system folders', `Change files in ${short(action.to || action.path)}?`);
  }
  return safe();
}

function urlRisk(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return never('that is not a link'); }
  if (parsed.protocol === 'javascript:' || parsed.protocol === 'data:' || parsed.protocol === 'file:') return never('that kind of link is not allowed');
  if (parsed.protocol === 'tel:' || parsed.protocol === 'facetime:' || parsed.protocol === 'facetime-audio:') return ask('it calls', `Call ${short(decodeURIComponent(parsed.pathname))}?`);
  if (parsed.protocol === 'sms:') return ask('it texts', `Text ${short(decodeURIComponent(parsed.pathname))}?`);
  if (!SAFE_SCHEMES.includes(parsed.protocol)) return ask('it opens another app', `Open this link: ${short(url)}?`);
  if (DOWNLOAD_LINKS.test(parsed.pathname)) return ask('it downloads an installer', `Download ${short(base(parsed.pathname))}?`);
  return safe();
}

function keysRisk(action, c) {
  const parts = action.combo.toLowerCase().split('+').map((p) => p.trim());
  const key = parts.at(-1);
  const mods = parts.slice(0, -1);
  if ((key === 'enter' || key === 'return') && messaging(c)) return ask('it sends', `Send this in ${c.app?.name || 'this app'}?`);
  if ((key === 'backspace' || key === 'delete') && mods.includes('cmd')) return ask('it deletes', 'Move the selected items to the Trash?');
  if ((key === 'enter' || key === 'return' || key === 'space') && (c.target || inSettings(c))) return elementRisk(action, c, c.target);
  return safe();
}

function baseRisk(action, c) {
  if (isPasswordApp(c.app)) return never("I don't touch password apps");
  const target = c.target;
  switch (action.type) {
    case 'type':
    case 'set_value':
      if (target?.role === 'password-field' || (!action.id && c.secure)) return never("I don't type into password fields");
      return inSettings(c) ? elementRisk(action, c, target) : safe(); // spec §7.2(3): a settings change asks
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
    case 'keys': return keysRisk(action, c);
    case 'menu': {
      const last = action.path.at(-1);
      return hasWord(last, RISK_WORDS) ? ask(`"${last}" can't be undone`, `Use "${short(last)}" in ${c.app?.name || 'this app'}?`) : safe();
    }
    case 'run': {
      const r = commandRisk(action.command);
      if (r.risk === 'never') return never(r.reason);
      return r.risk === 'ask' ? ask(r.reason, `Run this command: ${short(action.command)}?`) : safe();
    }
    case 'files': return filesRisk(action, c);
    case 'open_url': return urlRisk(action.url);
    case 'open_file':
      return INSTALLER_FILES.test(action.path) ? ask('it can install or run things', `Open "${base(action.path)}"? It can install or run things.`) : safe();
    default:
      return safe();
  }
}

function riskOf(action, ctx = {}) {
  const c = { app: null, title: '', target: null, dialog: '', exists: false, secure: false, risky: false, ...ctx };
  const r = baseRisk(action, c);
  if (r.risk === 'safe' && c.risky) return ask('the AI thinks it is risky', 'This step may be risky. Go ahead?');
  return r;
}

module.exports = { riskOf, commandRisk, isPasswordApp, RISK_WORDS, COMFORT_WORDS, COMFORT_NAMES, COMFORT_ROLES, READ_ONLY_COMMANDS };
