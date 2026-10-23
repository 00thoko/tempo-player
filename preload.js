const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('tempo', {
  openFiles: () => ipcRenderer.invoke('open-files'),
  openFolder: () => ipcRenderer.invoke('open-folder'),
  loadPaths: (paths) => ipcRenderer.invoke('load-paths', paths),
  pathForFile: (file) => webUtils.getPathForFile(file),
  onMediaKey: (cb) => ipcRenderer.on('media-key', (_e, action) => cb(action))
});
