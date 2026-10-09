'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('notch', {
  hover: (over) => ipcRenderer.send('notch:hover', over),
  click: () => ipcRenderer.send('notch:click'),
  claude: () => ipcRenderer.send('notch:claude'), // a click on Clawd: Claude mode
  // The face (face.js): the character's model, as the floating buddy's page gets it.
  model: () => ipcRenderer.invoke('notch:model'),
  onLayout: (fn) => ipcRenderer.on('notch:layout', (_event, layout) => fn(layout)),
  onMood: (fn) => ipcRenderer.on('notch:mood', (_event, name) => fn(name)),
  onSay: (fn) => ipcRenderer.on('notch:say', (_event, text) => fn(text)),
  onStatus: (fn) => ipcRenderer.on('notch:status', (_event, status) => fn(status)),
  onPause: (fn) => ipcRenderer.on('notch:pause', (_event, paused) => fn(paused)),
  onCursor: (fn) => ipcRenderer.on('notch:cursor', (_event, point) => fn(point)),
  onPanelOpen: (fn) => ipcRenderer.on('notch:panel-open', (_event, open) => fn(open)),
  onMicOn: (fn) => ipcRenderer.on('notch:mic-on', (_event, on) => fn(on)),
  onVoiceLevel: (fn) => ipcRenderer.on('notch:voice-level', (_event, level) => fn(level)),
  onReload: (fn) => ipcRenderer.on('notch:reload', () => fn()),
});
