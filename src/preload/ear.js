'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Only the main process sends to this page (ipcRenderer.on hears main alone); the page answers main alone.
contextBridge.exposeInMainWorld('ear', {
  onDo: (fn) => ipcRenderer.on('ear:do', (_event, msg) => fn(msg)),
  onStop: (fn) => ipcRenderer.on('ear:stop', () => fn()),
  onWake: (fn) => ipcRenderer.on('ear:wake', (_event, msg) => fn(msg)),
  // `phrase`: the wake phrase's own audio (base64 PCM16) for "Only my voice", or null. `asks`: nothing followed the phrase, so main says "Yes?" and then asks for the request (listen).
  woke: (msg) => ipcRenderer.send('ear:woke', { phrase: typeof msg?.phrase === 'string' ? msg.phrase : null, asks: msg?.asks === true }),
  request: (audio, phrase) => ipcRenderer.send('ear:request', { audio, phrase }),
  done: (id, result) => ipcRenderer.send('ear:done', { id, result }),
  model: () => ipcRenderer.invoke('ear:model'),
});
