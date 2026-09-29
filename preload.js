'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('worktime', {
  getInfo: () => ipcRenderer.invoke('app:info'),
  getLoginStatus: () => ipcRenderer.invoke('login:status'),
  openLoginItems: () => ipcRenderer.invoke('login:open-settings'),
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (patch) => ipcRenderer.invoke('config:save', patch),
  getToday: () => ipcRenderer.invoke('today:get'),
  getHistory: () => ipcRenderer.invoke('history:get'),
  setMarked: (id, done) => ipcRenderer.invoke('mark:set', id, done),
  setPaused: (paused) => ipcRenderer.invoke('pause:set', paused),
  getReminder: () => ipcRenderer.invoke('reminder:get'),
  snooze: (id) => ipcRenderer.invoke('reminder:snooze', id),
  onChange: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('state:changed', listener);
    return () => ipcRenderer.removeListener('state:changed', listener);
  },
});
