'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('buddy', {
  model: () => ipcRenderer.invoke('buddy:model'),
  hover: (over) => ipcRenderer.send('buddy:hover', over),
  dragStart: (point) => ipcRenderer.send('buddy:drag-start', point),
  dragMove: (point) => ipcRenderer.send('buddy:drag-move', point),
  dragEnd: () => ipcRenderer.send('buddy:drag-end'),
  click: () => ipcRenderer.send('buddy:click'),
  onMood: (fn) => ipcRenderer.on('buddy:mood', (_event, name) => fn(name)),
  onCursor: (fn) => ipcRenderer.on('buddy:cursor', (_event, point) => fn(point)),
  onVoiceLevel: (fn) => ipcRenderer.on('buddy:voice-level', (_event, level) => fn(level)),
  onPanelOpen: (fn) => ipcRenderer.on('buddy:panel-open', (_event, open) => fn(open)),
  onPause: (fn) => ipcRenderer.on('buddy:pause', (_event, paused) => fn(paused)),
  onReload: (fn) => ipcRenderer.on('buddy:reload', () => fn()),
});
