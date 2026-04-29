const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  gmail: {
    getConfig:     ()       => ipcRenderer.invoke('gmail:get-config'),
    saveConfig:    (data)   => ipcRenderer.invoke('gmail:save-config', data),
    authenticate:  ()       => ipcRenderer.invoke('gmail:authenticate'),
    signout:       ()       => ipcRenderer.invoke('gmail:signout'),
    fetchThreads:  (opts)   => ipcRenderer.invoke('gmail:fetch-threads', opts),
    fetchMessages:  (id)     => ipcRenderer.invoke('gmail:fetch-messages', { threadId: id }),
    send:           (params) => ipcRenderer.invoke('gmail:send', params),
    getAttachment:     (params) => ipcRenderer.invoke('gmail:get-attachment', params),
    getAttachmentData: (params) => ipcRenderer.invoke('gmail:get-attachment-data', params),
    markRead:          (params) => ipcRenderer.invoke('gmail:mark-read', params),
    markUnread:        (params) => ipcRenderer.invoke('gmail:mark-unread', params),
    trashThread:       (params) => ipcRenderer.invoke('gmail:trash-thread', params),
    fetchTrash:        (opts)   => ipcRenderer.invoke('gmail:fetch-trash', opts),
    restoreThread:     (params) => ipcRenderer.invoke('gmail:restore-thread', params),
  },
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
});
