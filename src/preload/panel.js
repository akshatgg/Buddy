'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('buddy', {
  // The whole chat: on a new opening (or a resumed chat), and after every change.
  onOpen: (fn) => ipcRenderer.on('panel:open', (_event, state) => fn(state)),
  onState: (fn) => ipcRenderer.on('panel:state', (_event, state) => fn(state)),
  send: (message) => ipcRenderer.invoke('panel:send', message),
  act: (id, button) => ipcRenderer.invoke('panel:act', id, button),
  dropSelection: () => ipcRenderer.invoke('panel:drop-selection'),
  close: () => ipcRenderer.send('panel:close'),
  openSettings: (code) => ipcRenderer.send('panel:open-settings', typeof code === 'string' ? code : undefined),
  // Voice: may the panel use the microphone (on the Mac this asks macOS the first time), write down a recording
  // (base64) through Buddy's server, and tell main when the panel listens and how loud the voice is (0 to 1).
  micAccess: () => ipcRenderer.invoke('panel:mic-access'),
  transcribe: (audio, mime) => ipcRenderer.invoke('panel:transcribe', audio, mime),
  listening: (on) => ipcRenderer.send('panel:listening', Boolean(on)),
  voiceLevel: (level) => ipcRenderer.send('panel:voice-level', level),
  // Claude mode: the Claude Code sessions running now, one of them shown as it goes, and words typed into its terminal.
  claudeSessions: () => ipcRenderer.invoke('panel:claude-sessions'),
  claudeOpen: (id) => ipcRenderer.invoke('panel:claude-open', id),
  claudeTalk: (id, text) => ipcRenderer.invoke('panel:claude-talk', id, text),
  claudeClose: () => ipcRenderer.send('panel:claude-close'),
  onClaudeState: (fn) => ipcRenderer.on('panel:claude-state', (_event, session) => fn(session)),
});
