import { contextBridge, ipcRenderer } from 'electron';

import type {
	DesktopApi,
	HuzzahProjectState,
	RepositoryChange,
	RepositoryState
} from '../shared/desktop';

const desktop: DesktopApi = Object.freeze({
	platform: process.platform,
	getRepositoryState: () => ipcRenderer.invoke('repository:get-state') as Promise<RepositoryState>,
	openRepository: () => ipcRenderer.invoke('repository:open') as Promise<RepositoryState | null>,
	closeRepository: () => ipcRenderer.invoke('repository:close') as Promise<void>,
	readFile: (path) => ipcRenderer.invoke('repository:read-file', path),
	createFile: (request) => ipcRenderer.invoke('repository:create-file', request),
	writeFile: (request) => ipcRenderer.invoke('repository:write-file', request),
	getProjectState: () => ipcRenderer.invoke('project:get-state'),
	initializeProject: () => ipcRenderer.invoke('project:initialize'),
	refreshProjectState: () => ipcRenderer.invoke('project:refresh'),
	getSyncSummary: () => ipcRenderer.invoke('project:get-sync-summary'),
	getGeneratedMetadata: (specificationPath) => ipcRenderer.invoke('project:get-generated-metadata', specificationPath),
	onRepositoryChange: (listener) => {
		const handler = (_event: Electron.IpcRendererEvent, change: RepositoryChange) => listener(change);
		ipcRenderer.on('repository:change', handler);
		return () => ipcRenderer.removeListener('repository:change', handler);
	},
	onProjectStateChange: (listener) => {
		const handler = (_event: Electron.IpcRendererEvent, state: HuzzahProjectState) => listener(state);
		ipcRenderer.on('project:change', handler);
		return () => ipcRenderer.removeListener('project:change', handler);
	}
});

contextBridge.exposeInMainWorld('desktop', desktop);
