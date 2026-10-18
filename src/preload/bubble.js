'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('buddy', {
  onText: (fn) => ipcRenderer.on('bubble:text', (_event, text, speech, buttons, token) => fn(text, speech === true, Array.isArray(buttons) ? buttons : [], typeof token === 'string' ? token : '')),
  hover: (over) => ipcRenderer.send('bubble:hover', over === true),
  click: () => ipcRenderer.send('bubble:click'),
  button: (name, token) => ipcRenderer.send('bubble:button', String(name), String(token || '')),
});
