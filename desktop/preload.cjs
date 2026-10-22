const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('whale', Object.freeze({
  onState(callback) {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('whale:state', listener);
    ipcRenderer.send('whale:ready');
    return () => ipcRenderer.removeListener('whale:state', listener);
  },
  decide: (id, decision) => ipcRenderer.invoke('whale:decide', id, decision),
  answer: (id, answers) => ipcRenderer.invoke('whale:answer', String(id), answers),
  startChat: (text, sessionId, workspaceId) => ipcRenderer.invoke('whale:chat', String(text ?? ''), typeof sessionId === 'string' ? sessionId : null, typeof workspaceId === 'string' ? workspaceId : null),
  setExpanded: (expanded, height, width) => ipcRenderer.send('whale:expanded', Boolean(expanded), Number(height) || 0, Number(width) || 0),
  setAlwaysOnTop: (value) => ipcRenderer.send('whale:top', Boolean(value)),
  hide: () => ipcRenderer.send('whale:hide'),
  setInteractive: (value) => ipcRenderer.send('whale:interactive', Boolean(value)),
  dragStart: () => ipcRenderer.send('whale:drag', 'start'),
  dragEnd: () => ipcRenderer.send('whale:drag', 'end'),
}));
