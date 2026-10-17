'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('buddy', {
  onText: (fn) => ipcRenderer.on('bubble:text', (_event, text, speech) => fn(text, speech === true)),
  hover: (over) => ipcRenderer.send('bubble:hover', over === true),
  click: () => ipcRenderer.send('bubble:click'),
});
