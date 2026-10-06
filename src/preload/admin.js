'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('buddy', {
  settings: () => ipcRenderer.invoke('admin:settings'),
  save: (patch) => ipcRenderer.invoke('admin:save', patch),
  models: (provider) => ipcRenderer.invoke('admin:models', provider),
  users: () => ipcRenderer.invoke('admin:users'),
  block: (uid, blocked) => ipcRenderer.invoke('admin:block', uid, blocked),
});
