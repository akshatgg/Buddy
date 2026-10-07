'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { sendKeyFor, undoKey } = require('../src/main/send-keys');

const RETURN = { key: 'return', modifiers: [] };
const CMD_RETURN = { key: 'return', modifiers: ['cmd'] };
const CTRL_RETURN = { key: 'return', modifiers: ['ctrl'] };

// The browsers, as each system names them: the Mac by bundle id, Windows by program file (which the helper reports as
// the bundle id).
const MAC_BROWSERS = [
  ['com.google.Chrome', 'Google Chrome'],
  ['com.apple.Safari', 'Safari'],
  ['company.thebrowser.Browser', 'Arc'],
  ['com.microsoft.edgemac', 'Microsoft Edge'],
  ['org.mozilla.firefox', 'Firefox'],
  ['com.brave.Browser', 'Brave Browser'],
];
const WINDOWS_BROWSERS = [
  ['chrome.exe', 'Google Chrome'],
  ['msedge.exe', 'Microsoft Edge'],
  ['firefox.exe', 'Firefox'],
  ['brave.exe', 'Brave Browser'],
];

const mac = (bundleId, name, title = '') => sendKeyFor({ bundleId, name, title }, 'darwin');
const win = (bundleId, name, title = '') => sendKeyFor({ bundleId, name, title }, 'win32');

test('Undo is ⌘Z on the Mac and Ctrl+Z everywhere else', () => {
  assert.deepStrictEqual(undoKey('darwin'), { key: 'z', modifiers: ['cmd'] });
  assert.deepStrictEqual(undoKey('win32'), { key: 'z', modifiers: ['ctrl'] });
  assert.deepStrictEqual(undoKey('linux'), { key: 'z', modifiers: ['ctrl'] });
});

test('Apple Mail sends with ⌘⇧D', () => {
  assert.deepStrictEqual(mac('com.apple.mail', 'Mail', 'Re: Leave tomorrow'), { key: 'd', modifiers: ['cmd', 'shift'] });
});

test('Outlook sends with ⌘↩ on the Mac and Ctrl+↩ on Windows, the classic one and the new one', () => {
  assert.deepStrictEqual(mac('com.microsoft.Outlook', 'Microsoft Outlook'), CMD_RETURN);
  assert.deepStrictEqual(win('outlook.exe', 'Microsoft Outlook'), CTRL_RETURN);
  assert.deepStrictEqual(win('olk.exe', 'Outlook'), CTRL_RETURN);
  assert.deepStrictEqual(win('OUTLOOK.EXE', 'Microsoft Outlook'), CTRL_RETURN, 'Windows program files in any case');
});

test('Gmail and Outlook in a browser are told by the window title: ⌘↩ on the Mac', () => {
  for (const [bundleId, name] of MAC_BROWSERS) {
    assert.deepStrictEqual(mac(bundleId, name, 'Inbox (3) - akshat@gmail.com - Gmail'), CMD_RETURN, `Gmail in ${name}`);
    assert.deepStrictEqual(mac(bundleId, name, 'Mail - Akshat Gupta - Outlook'), CMD_RETURN, `Outlook in ${name}`);
  }
});

test('Gmail and Outlook in a browser are told by the window title: Ctrl+↩ on Windows', () => {
  for (const [bundleId, name] of WINDOWS_BROWSERS) {
    assert.deepStrictEqual(win(bundleId, name, `Inbox (3) - akshat@gmail.com - Gmail - ${name}`), CTRL_RETURN, `Gmail in ${name}`);
    assert.deepStrictEqual(win(bundleId, name, `Mail - Akshat Gupta - Outlook - ${name}`), CTRL_RETURN, `Outlook in ${name}`);
  }
});

test('the chat apps send with ↩, on the Mac and on Windows', () => {
  const apps = [
    ['net.whatsapp.WhatsApp', 'WhatsApp'],
    ['desktop.WhatsApp', 'WhatsApp'],
    ['ru.keepcoder.Telegram', 'Telegram'],
    ['org.telegram.desktop', 'Telegram Desktop'],
    ['com.tinyspeck.slackmacgap', 'Slack'],
    ['com.hnc.Discord', 'Discord'],
    ['com.microsoft.teams2', 'Microsoft Teams'],
    ['com.microsoft.teams', 'Microsoft Teams classic'],
    ['com.apple.MobileSMS', 'Messages'],
    ['org.whispersystems.signal-desktop', 'Signal'],
  ];
  for (const [bundleId, name] of apps) assert.deepStrictEqual(mac(bundleId, name), RETURN, name);
  const programs = [
    ['WhatsApp.exe', 'WhatsApp'],
    ['WhatsApp.Root.exe', 'WhatsApp'],
    ['Telegram.exe', 'Telegram Desktop'],
    ['slack.exe', 'Slack'],
    ['Discord.exe', 'Discord'],
    ['ms-teams.exe', 'Microsoft Teams'],
    ['Teams.exe', 'Microsoft Teams classic'],
    ['Signal.exe', 'Signal'],
  ];
  for (const [bundleId, name] of programs) assert.deepStrictEqual(win(bundleId, name), RETURN, bundleId);
});

test('the chat sites in a browser tab send with ↩', () => {
  const titles = [
    '(2) WhatsApp',
    'Telegram Web',
    'general (Channel) - Acme - Slack',
    'Discord | #general | Acme',
    'Chat | Rahul Sharma | Microsoft Teams',
  ];
  for (const title of titles) {
    assert.deepStrictEqual(mac('com.google.Chrome', 'Google Chrome', title), RETURN, title);
    assert.deepStrictEqual(win('msedge.exe', 'Microsoft Edge', `${title} - Microsoft Edge`), RETURN, title);
  }
});

test('an app whose id is not known is found by its name', () => {
  // Store apps on Windows all run as ApplicationFrameHost.exe, named by their window.
  assert.deepStrictEqual(win('ApplicationFrameHost.exe', 'WhatsApp'), RETURN);
  assert.deepStrictEqual(mac('com.example.slack-beta', 'Slack'), RETURN);
  assert.deepStrictEqual(mac('', 'Telegram'), RETURN);
  assert.deepStrictEqual(mac('com.example.mail', 'Mail'), { key: 'd', modifiers: ['cmd', 'shift'] });
  assert.deepStrictEqual(win('', '  microsoft outlook  '), CTRL_RETURN, 'names in any case, spaces around them ignored');
  // A browser that is not in the list by its id is still one by its name.
  assert.deepStrictEqual(mac('com.google.Chrome.beta', 'Google Chrome', 'Inbox - Gmail'), CMD_RETURN);
});

test('Apple Mail\'s keys are for the Mac only: an app called Mail on Windows has none', () => {
  assert.strictEqual(win('ApplicationFrameHost.exe', 'Mail'), null);
});

test('anywhere else there is no send key', () => {
  assert.strictEqual(mac('com.apple.Notes', 'Notes', 'Gmail ideas'), null, 'a title counts only in a browser');
  assert.strictEqual(mac('com.apple.TextEdit', 'TextEdit'), null);
  assert.strictEqual(win('notepad.exe', 'Notepad', 'WhatsApp draft.txt - Notepad'), null);
  assert.strictEqual(mac('com.google.Chrome', 'Google Chrome', 'Google Docs'), null, 'a site that is not known');
  assert.strictEqual(win('chrome.exe', 'Google Chrome', 'New Tab - Google Chrome'), null);
  assert.strictEqual(mac('com.apple.Safari', 'Safari', ''), null, 'a window with no title');
  assert.strictEqual(mac('com.apple.Safari', 'Safari', undefined), null);
  assert.strictEqual(sendKeyFor({}, 'darwin'), null);
  assert.strictEqual(sendKeyFor(null, 'win32'), null);
});

test('titles are matched ignoring case', () => {
  assert.deepStrictEqual(mac('com.google.Chrome', 'Google Chrome', 'INBOX - GMAIL'), CMD_RETURN);
  assert.deepStrictEqual(mac('com.apple.Safari', 'Safari', 'whatsapp'), RETURN);
  assert.deepStrictEqual(win('firefox.exe', 'Firefox', 'mail - outlook — Mozilla Firefox'), CTRL_RETURN);
});

test('a site is told by its whole name, not by a part of another word', () => {
  assert.strictEqual(mac('com.google.Chrome', 'Google Chrome', 'Slacker radio'), null);
  assert.strictEqual(mac('com.google.Chrome', 'Google Chrome', 'Teams of the league'), null);
});

test('the mail sites win over a chat name in the title (a subject in Gmail can name anything)', () => {
  assert.deepStrictEqual(mac('com.google.Chrome', 'Google Chrome', 'Re: the Slack invite - akshat@gmail.com - Gmail'), CMD_RETURN);
});

test('every answer is one of the keys and modifiers the helpers accept, and a new copy each time', () => {
  const keys = ['return', 'z', 'd'];
  const modifiers = ['cmd', 'ctrl', 'shift', 'alt'];
  const answers = [
    mac('com.apple.mail', 'Mail'), mac('com.microsoft.Outlook', 'Outlook'), win('olk.exe', 'Outlook'),
    mac('com.tinyspeck.slackmacgap', 'Slack'), win('chrome.exe', 'Google Chrome', 'Gmail'),
    undoKey('darwin'), undoKey('win32'),
  ];
  for (const answer of answers) {
    assert.ok(keys.includes(answer.key), answer.key);
    for (const m of answer.modifiers) assert.ok(modifiers.includes(m), m);
  }
  const first = mac('com.apple.mail', 'Mail');
  first.modifiers.push('alt');
  assert.deepStrictEqual(mac('com.apple.mail', 'Mail'), { key: 'd', modifiers: ['cmd', 'shift'] });
  const undo = undoKey('darwin');
  undo.modifiers.length = 0;
  assert.deepStrictEqual(undoKey('darwin'), { key: 'z', modifiers: ['cmd'] });
});

test('the system Buddy runs on is the default', () => {
  const expected = sendKeyFor({ bundleId: 'com.microsoft.Outlook', name: 'Microsoft Outlook' }, process.platform);
  assert.deepStrictEqual(sendKeyFor({ bundleId: 'com.microsoft.Outlook', name: 'Microsoft Outlook' }), expected);
  assert.deepStrictEqual(undoKey(), undoKey(process.platform));
});
