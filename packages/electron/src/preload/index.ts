import { contextBridge, ipcRenderer } from 'electron';

import type { DesktopApi, RepositoryChange, RepositoryState } from '../shared/desktop';

const desktop: DesktopApi = Object.freeze({
	platform: process.platform,
	getRepositoryState: () => ipcRenderer.invoke('repository:get-state') as Promise<RepositoryState>,
	openRepository: () => ipcRenderer.invoke('repository:open') as Promise<RepositoryState | null>,
	closeRepository: () => ipcRenderer.invoke('repository:close') as Promise<void>,
	readFile: (path) => ipcRenderer.invoke('repository:read-file', path),
	writeFile: (request) => ipcRenderer.invoke('repository:write-file', request),
	onRepositoryChange: (listener) => {
		const handler = (_event: Electron.IpcRendererEvent, change: RepositoryChange) => listener(change);
		ipcRenderer.on('repository:change', handler);
		return () => ipcRenderer.removeListener('repository:change', handler);
	}
});

contextBridge.exposeInMainWorld('desktop', desktop);
