'use strict';

/**
 * IPC for the panel. Every answer is { ok: true, ... } or { ok: false, error }. The chat lives in actions.js, which
 * sends the page the whole state on 'panel:open' and 'panel:state': the page only sends what the person types and
 * the buttons they press. For voice (docs/superpowers/plans/2026-10-08-buddy-voice.md, V2) the page records and works
 * out when the person has finished; here macOS is asked for the microphone, the recording goes to Buddy's server to be
 * written down, and the buddy hears when the page listens and how loud the person speaks.
 */

const { guarded } = require('./result');
const { sectionFor } = require('../actions');

// Where Windows turns the microphone on and off for apps (it does not ask per app, as macOS does).
const WINDOWS_MICROPHONE = 'ms-settings:privacy-microphone';

/**
 * The microphone as the system sees it. On the Mac, whether macOS lets Buddy use it: 'granted', 'denied',
 * 'not-determined' (never asked yet) or 'restricted' (the Mac's owner decides). Windows does not ask per app, so there
 * it is 'unknown': a microphone switched off in Windows Settings shows only when the page tries to record.
 * `systemPreferences` is Electron's (the end-to-end test passes its own).
 */
function createMicrophone({ systemPreferences, platform = process.platform }) {
  const mac = platform === 'darwin';
  const status = () => (mac ? systemPreferences.getMediaAccessStatus('microphone') : 'unknown');
  return {
    status,
    /**
     * How it stands once macOS has asked the person, if it never has: it asks only once, and after that the switch is
     * in System Settings.
     */
    async ask() {
      if (mac && status() === 'not-determined') await systemPreferences.askForMediaAccess('microphone');
      return status();
    },
  };
}

/**
 * `microphone` is createMicrophone()'s; `ui` has the buddy's two voice hooks, listening(on) and voiceLevel(0..1)
 * (main.js). `shell` opens Windows' Settings; Electron's is loaded only when none is given, so that these handlers can
 * be tested in plain Node.
 */
function registerPanelIpc({ ipcMain, panel, actions, openSettings, microphone, ui, shell, platform = process.platform }) {
  const fromPanel = (webContents) => webContents === panel.window()?.webContents;
  const handle = guarded(ipcMain, fromPanel);
  const openExternal = (url) => (shell || require('electron').shell).openExternal(url);

  // Answers once the answer is in (or it failed, which then shows in the chat).
  handle('panel:send', (message) => actions.send(typeof message === 'string' ? message : ''));
  handle('panel:act', (id, button) => actions.act(id, button));
  handle('panel:drop-selection', () => actions.dropSelection());

  // Before it records, the page asks for the microphone: the first time, macOS asks the person.
  handle('panel:mic-access', async () => ({ mic: await microphone.ask() }));
  // What was said, written down by Buddy's server: { text }. The page sends the words as a message of its own.
  handle('panel:transcribe', (audio, mime) => actions.transcribe(audio, mime));

  // For the buddy's feelings: while the page listens, and how loud the person speaks (the page sends it about 10 times
  // a second). A level that is not a number is let go; any other is kept between 0 and 1.
  ipcMain.on('panel:listening', (event, on) => {
    if (fromPanel(event.sender)) ui.listening(Boolean(on));
  });
  ipcMain.on('panel:voice-level', (event, level) => {
    if (!fromPanel(event.sender) || typeof level !== 'number' || Number.isNaN(level)) return;
    ui.voiceLevel(Math.min(1, Math.max(0, level)));
  });

  ipcMain.on('panel:close', (event) => {
    // Through actions, which ends the chat and on Windows also hands the keyboard back to the app it was opened from.
    if (fromPanel(event.sender)) actions.dismiss().catch((err) => console.error('[buddy] could not close the panel', err));
  });
  ipcMain.on('panel:open-settings', (event, code) => {
    if (!fromPanel(event.sender)) return;
    panel.hide();
    if (code !== 'no_microphone') {
      openSettings(sectionFor(code));
    } else if (platform === 'win32') {
      // The microphone's switch on Windows is in Windows' own Settings: Buddy's has nothing to show for it.
      Promise.resolve(openExternal(WINDOWS_MICROPHONE)).catch((err) => console.error("[buddy] could not open Windows' Settings", err));
    } else {
      openSettings('permissions'); // the Microphone row, with Allow
    }
  });
}

module.exports = { registerPanelIpc, createMicrophone };
