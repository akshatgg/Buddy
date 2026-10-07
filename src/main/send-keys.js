'use strict';

/**
 * The keys that send in the app the person is in, for "Send it?", and the keys that undo, for Undo. Buddy presses them
 * through the helper's `press` (src/main/actions.js).
 *
 * An app is known on the Mac by its bundle id and on Windows by its program file (chrome.exe), which the helper
 * reports as the bundle id too. In a browser the window's title says which site is open (Gmail, WhatsApp Web, …). An
 * app whose id is not in the table is looked up by its name: Store apps on Windows all run as ApplicationFrameHost.exe,
 * and a beta or a copy from another store has an id of its own. Anywhere else there is no send key (null), and the
 * person presses Send themselves.
 */

const key = (name, ...modifiers) => ({ key: name, modifiers });

// What sends, on the Mac and on Windows (and on any other system, as on Windows): ⌘ on the Mac is Ctrl on Windows.
const RETURN = { mac: key('return'), windows: key('return') };
const CMD_RETURN = { mac: key('return', 'cmd'), windows: key('return', 'ctrl') };
const MAIL = { mac: key('d', 'cmd', 'shift'), windows: null }; // Message › Send in Apple Mail, which is Mac only

// Each app or site: its bundle ids and program files, its names, the words that name it in a browser window's title
// (none for an app that has no web version), and what sends. Ids, files and names are in lower case. The mail sites
// come first: a mail's subject is in the title, and it can name anything.
const SENDERS = [
  { ids: ['com.apple.mail'], names: ['mail'], send: MAIL },
  { ids: [], names: ['gmail'], title: /\bgmail\b/i, send: CMD_RETURN },
  {
    ids: ['com.microsoft.outlook', 'outlook.exe', 'olk.exe'], // olk.exe is the new Outlook for Windows
    names: ['microsoft outlook', 'outlook', 'outlook (new)'],
    title: /\boutlook\b/i,
    send: CMD_RETURN,
  },
  {
    // The Mac app, the old Mac app, the Windows app, and its newer build.
    ids: ['net.whatsapp.whatsapp', 'desktop.whatsapp', 'whatsapp.exe', 'whatsapp.root.exe'],
    names: ['whatsapp', 'whatsapp web'],
    title: /\bwhatsapp\b/i,
    send: RETURN,
  },
  {
    // Telegram for macOS, and Telegram Desktop on either system.
    ids: ['ru.keepcoder.telegram', 'org.telegram.desktop', 'telegram.exe'],
    names: ['telegram', 'telegram desktop', 'telegram web'],
    title: /\btelegram\b/i,
    send: RETURN,
  },
  { ids: ['com.tinyspeck.slackmacgap', 'slack.exe'], names: ['slack'], title: /\bslack\b/i, send: RETURN },
  { ids: ['com.hnc.discord', 'discord.exe'], names: ['discord'], title: /\bdiscord\b/i, send: RETURN },
  {
    // The new Teams and the classic one.
    ids: ['com.microsoft.teams2', 'com.microsoft.teams', 'ms-teams.exe', 'teams.exe'],
    names: ['microsoft teams', 'microsoft teams (work or school)', 'microsoft teams classic', 'microsoft teams (free)'],
    title: /\bmicrosoft teams\b/i,
    send: RETURN,
  },
  { ids: ['com.apple.mobilesms'], names: ['messages'], send: RETURN },
  { ids: ['org.whispersystems.signal-desktop', 'signal.exe'], names: ['signal'], send: RETURN },
];

// Chrome, Safari, Arc, Edge, Firefox and Brave.
const BROWSERS = {
  ids: [
    'com.google.chrome', 'com.apple.safari', 'company.thebrowser.browser', 'com.microsoft.edgemac', 'org.mozilla.firefox',
    'com.brave.browser', 'chrome.exe', 'msedge.exe', 'firefox.exe', 'brave.exe', 'arc.exe',
  ],
  names: ['google chrome', 'safari', 'arc', 'microsoft edge', 'firefox', 'brave browser', 'brave'],
};

const lower = (text) => (typeof text === 'string' ? text.trim().toLowerCase() : '');

/** The entry of SENDERS for this app, or undefined. */
function senderOf({ bundleId, name, title }) {
  const id = lower(bundleId);
  const appName = lower(name);
  const app = SENDERS.find((s) => s.ids.includes(id));
  if (app) return app;
  if (BROWSERS.ids.includes(id) || BROWSERS.names.includes(appName)) {
    const words = typeof title === 'string' ? title : '';
    return SENDERS.find((s) => s.title && s.title.test(words));
  }
  return SENDERS.find((s) => s.names.includes(appName));
}

/** A copy, so that a caller that changes it changes nothing here. */
const copy = (keys) => (keys ? { key: keys.key, modifiers: [...keys.modifiers] } : null);

/**
 * The keys that send in `app` ({ bundleId, name, title }, title being its front window's): { key, modifiers }, or null
 * when they are not known.
 */
function sendKeyFor(app, platform = process.platform) {
  const sender = app ? senderOf(app) : undefined;
  if (!sender) return null;
  return copy(platform === 'darwin' ? sender.send.mac : sender.send.windows);
}

/** The keys that undo: ⌘Z on the Mac, Ctrl+Z elsewhere. */
function undoKey(platform = process.platform) {
  return platform === 'darwin' ? key('z', 'cmd') : key('z', 'ctrl');
}

module.exports = { sendKeyFor, undoKey };
