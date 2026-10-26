const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('whale', Object.freeze({
  onState(callback) {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('whale:state', listener);
    ipcRenderer.send('whale:ready');
    return () => ipcRenderer.removeListener('whale:state', listener);
  },
  decide: (id, decision) => ipcRenderer.invoke('whale:decide', id, decision),
  onEdge(callback) {
    const listener = (_event, side) => callback(side);
    ipcRenderer.on('whale:edge', listener);
    return () => ipcRenderer.removeListener('whale:edge', listener);
  },
  onArea(callback) {
    const listener = (_event, area) => callback(area);
    ipcRenderer.on('whale:area', listener);
    return () => ipcRenderer.removeListener('whale:area', listener);
  },
  reportPetRect: rect => ipcRenderer.send('whale:pet-rect', rect),
  onEdgeHint(callback) {
    const listener = (_event, hint) => callback(hint);
    ipcRenderer.on('whale:edge-hint', listener);
    return () => ipcRenderer.removeListener('whale:edge-hint', listener);
  },
  onLanding(callback) {
    const listener = (_event, landing) => callback(landing);
    ipcRenderer.on('whale:landing', listener);
    return () => ipcRenderer.removeListener('whale:landing', listener);
  },
  revealEdge: () => ipcRenderer.send('whale:reveal'),
  answer: (id, answers) => ipcRenderer.invoke('whale:answer', String(id), answers),
  startChat: (text, sessionId, workspaceId) => ipcRenderer.invoke('whale:chat', String(text ?? ''), typeof sessionId === 'string' ? sessionId : null, typeof workspaceId === 'string' ? workspaceId : null),
  setExpanded: (expanded, height, width) => ipcRenderer.send('whale:expanded', Boolean(expanded), Number(height) || 0, Number(width) || 0),
  setAlwaysOnTop: (value) => ipcRenderer.send('whale:top', Boolean(value)),
  hide: () => ipcRenderer.send('whale:hide'),
  openDsh: () => ipcRenderer.send('whale:open-dsh'),
  openSession: sessionId => ipcRenderer.invoke('whale:open-session', sessionId),
  setInteractive: (value) => ipcRenderer.send('whale:interactive', Boolean(value)),
  dragStart: () => ipcRenderer.send('whale:drag', 'start'),
  dragEnd: () => ipcRenderer.send('whale:drag', 'end'),
}));
