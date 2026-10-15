'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Only the main process sends to this page (ipcRenderer.on hears main alone); the page answers main alone.
contextBridge.exposeInMainWorld('ear', {
  onDo: (fn) => ipcRenderer.on('ear:do', (_event, msg) => fn(msg)),
  onStop: (fn) => ipcRenderer.on('ear:stop', () => fn()),
  onWake: (fn) => ipcRenderer.on('ear:wake', (_event, msg) => fn(msg)),
  woke: () => ipcRenderer.send('ear:woke'),
  request: (audio) => ipcRenderer.send('ear:request', { audio }),
  done: (id, result) => ipcRenderer.send('ear:done', { id, result }),
  model: () => ipcRenderer.invoke('ear:model'),
});
