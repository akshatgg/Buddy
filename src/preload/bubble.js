'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('buddy', {
  onText: (fn) => ipcRenderer.on('bubble:text', (_event, text, speech, buttons) => fn(text, speech === true, Array.isArray(buttons) ? buttons : [])),
  hover: (over) => ipcRenderer.send('bubble:hover', over === true),
  click: () => ipcRenderer.send('bubble:click'),
  button: (name) => ipcRenderer.send('bubble:button', String(name)),
});
