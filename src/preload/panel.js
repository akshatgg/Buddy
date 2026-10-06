'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('buddy', {
  onOpen: (fn) => ipcRenderer.on('panel:open', (_event, state) => fn(state)),
  wholeBox: () => ipcRenderer.invoke('panel:whole-box'),
  run: (action, input) => ipcRenderer.invoke('panel:run', action, input),
  screenshot: () => ipcRenderer.invoke('panel:screenshot'),
  insert: (text, mode) => ipcRenderer.invoke('panel:insert', text, mode),
  copy: (text) => ipcRenderer.invoke('panel:copy', text),
  close: () => ipcRenderer.send('panel:close'),
  openSettings: () => ipcRenderer.send('panel:open-settings'),
});
