'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('buddy', {
  get: () => ipcRenderer.invoke('settings:get'),
  refresh: () => ipcRenderer.invoke('settings:refresh'),
  set: (patch) => ipcRenderer.invoke('settings:set', patch),
  saveKey: (provider, key) => ipcRenderer.invoke('settings:save-key', provider, key),
  clearKey: (provider) => ipcRenderer.invoke('settings:clear-key', provider),
  models: (provider) => ipcRenderer.invoke('settings:models', provider),
  setBuddyOn: (on) => ipcRenderer.invoke('settings:buddy-on', on),
  signIn: () => ipcRenderer.invoke('account:sign-in'),
  signOut: () => ipcRenderer.invoke('account:sign-out'),
  permissions: () => ipcRenderer.invoke('permissions:get'),
  requestPermission: (which) => ipcRenderer.invoke('permissions:request', which),
  openPermissionSettings: (which) => ipcRenderer.invoke('permissions:open', which),
  openUrl: (url) => ipcRenderer.invoke('settings:open-url', url),
  finishOnboarding: (choice) => ipcRenderer.invoke('onboarding:finish', choice),
  pauseShortcut: () => ipcRenderer.invoke('shortcut:pause'),
  resumeShortcut: () => ipcRenderer.invoke('shortcut:resume'),
  onSection: (fn) => ipcRenderer.on('settings:section', (_event, name) => fn(name)),
});
