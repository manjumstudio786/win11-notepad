'use strict';

/*
 * Notepad 1.0.1 - preload script.
 * contextBridge + ipcRenderer + webUtils are documented Electron APIs.
 * webUtils.getPathForFile exists since Electron 32 and returns the real
 * file-system path for a File object dropped onto the window.
 */
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('notepadAPI', {
  openFileDialog: () => ipcRenderer.invoke('dialog:openFile'),
  saveFileDialog: (suggestedPath) => ipcRenderer.invoke('dialog:saveFile', suggestedPath),
  readFile: (filePath) => ipcRenderer.invoke('file:read', filePath),
  writeFile: (filePath, content, encoding, lineEnding) => ipcRenderer.invoke('file:write', filePath, content, encoding, lineEnding),
  printPage: () => ipcRenderer.invoke('file:print'),
  exportPdf: () => ipcRenderer.invoke('file:exportPdf'),
  getStore: (name, fallback) => ipcRenderer.invoke('store:get', name, fallback),
  setStore: (name, data) => ipcRenderer.invoke('store:set', name, data),
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  newWindow: () => ipcRenderer.invoke('app:newWindow'),
  openDefaultAppsSettings: () => ipcRenderer.invoke('app:openDefaultApps'),
  showItemInFolder: (filePath) => ipcRenderer.invoke('app:showItemInFolder', filePath),
  // 1.1.0: frameless window - custom minimize / maximize / close buttons
  // in the tab-bar title row, and opening http(s) links from the
  // formatted view (Ctrl+click). openExternal only allows http/https.
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowMaximizeToggle: () => ipcRenderer.invoke('window:maximize-toggle'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  windowIsMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  onOpenFileArg: (callback) => ipcRenderer.on('app:open-file-arg', (_event, data) => callback(data))
});
