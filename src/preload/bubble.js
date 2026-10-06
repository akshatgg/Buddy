'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('buddy', {
  onText: (fn) => ipcRenderer.on('bubble:text', (_event, text) => fn(text)),
});
