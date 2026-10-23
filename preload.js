const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('tempo', {
  openFiles: () => ipcRenderer.invoke('open-files'),
  openFolder: () => ipcRenderer.invoke('open-folder'),
  loadPaths: (paths) => ipcRenderer.invoke('load-paths', paths),
  pathForFile: (file) => webUtils.getPathForFile(file),
  onMediaKey: (cb) => ipcRenderer.on('media-key', (_e, action) => cb(action)),

  // Library
  libraryGet: () => ipcRenderer.invoke('library:get'),
  libraryScan: () => ipcRenderer.invoke('library:scan'),
  libraryAddFolder: () => ipcRenderer.invoke('library:add-folder'),
  libraryRemoveFolder: (folder) => ipcRenderer.invoke('library:remove-folder', folder),
  onLibraryProgress: (cb) => ipcRenderer.on('library:progress', (_e, p) => cb(p))
});
