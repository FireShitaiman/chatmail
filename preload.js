const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  gmail: {
    getConfig:     ()       => ipcRenderer.invoke('gmail:get-config'),
    saveConfig:    (data)   => ipcRenderer.invoke('gmail:save-config', data),
    authenticate:  ()       => ipcRenderer.invoke('gmail:authenticate'),
    signout:       ()       => ipcRenderer.invoke('gmail:signout'),
    fetchThreads:  ()       => ipcRenderer.invoke('gmail:fetch-threads'),
    fetchMessages: (id)     => ipcRenderer.invoke('gmail:fetch-messages', { threadId: id }),
    send:          (params) => ipcRenderer.invoke('gmail:send', params),
  },
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
});
