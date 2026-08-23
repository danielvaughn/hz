import { contextBridge, ipcRenderer } from 'electron';

import type { DesktopApi, RepositoryState } from '../shared/desktop';

const desktop: DesktopApi = Object.freeze({
	platform: process.platform,
	getRepositoryState: () => ipcRenderer.invoke('repository:get-state') as Promise<RepositoryState>,
	openRepository: () => ipcRenderer.invoke('repository:open') as Promise<RepositoryState | null>,
	closeRepository: () => ipcRenderer.invoke('repository:close') as Promise<void>,
	readFile: (path) => ipcRenderer.invoke('repository:read-file', path)
});

contextBridge.exposeInMainWorld('desktop', desktop);
