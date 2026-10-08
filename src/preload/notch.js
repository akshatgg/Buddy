'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('notch', {
  hover: (over) => ipcRenderer.send('notch:hover', over),
  click: () => ipcRenderer.send('notch:click'),
  onLayout: (fn) => ipcRenderer.on('notch:layout', (_event, layout) => fn(layout)),
  onMood: (fn) => ipcRenderer.on('notch:mood', (_event, name) => fn(name)),
  onSay: (fn) => ipcRenderer.on('notch:say', (_event, text) => fn(text)),
  onPause: (fn) => ipcRenderer.on('notch:pause', (_event, paused) => fn(paused)),
  onCursor: (fn) => ipcRenderer.on('notch:cursor', (_event, point) => fn(point)),
});
