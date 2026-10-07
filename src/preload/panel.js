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
});
