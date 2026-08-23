import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
	CreateFileRequest,
	RepositoryChange,
	RepositoryState,
	SaveFileRequest,
	HuzzahProjectState,
	RegenerateHighlightingRequest
} from '../shared/desktop';
import { REVIEW_FIXTURE_NAMES, type ReviewFixtureName } from '../shared/desktop';
import { ProjectService } from './project-service';
import { RepositoryService } from './repository-service';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const SETTINGS_FILE = 'desktop-settings.json';

function broadcast(channel: string, payload: unknown): void {
	for (const window of BrowserWindow.getAllWindows()) {
		if (!window.isDestroyed()) window.webContents.send(channel, payload);
	}
}

function emitRepositoryChange(change: RepositoryChange): void {
	broadcast('repository:change', change);
}

function emitProjectStateChange(state: HuzzahProjectState): void {
	broadcast('project:change', state);
}

const projectService = new ProjectService(emitProjectStateChange);
const repositoryService = new RepositoryService(
	() => join(app.getPath('userData'), SETTINGS_FILE),
	emitRepositoryChange,
	(delayMs) => projectService.scheduleRefresh(delayMs)
);

function isSaveFileRequest(value: unknown): value is SaveFileRequest {
	if (!value || typeof value !== 'object') return false;
	const request = value as Partial<SaveFileRequest>;
	return typeof request.repositoryPath === 'string' && typeof request.path === 'string' &&
		typeof request.content === 'string' && typeof request.expectedRevision === 'string';
}

function isCreateFileRequest(value: unknown): value is CreateFileRequest {
	if (!value || typeof value !== 'object') return false;
	const request = value as Partial<CreateFileRequest>;
	return typeof request.repositoryPath === 'string' && typeof request.path === 'string';
}

function isRegenerateHighlightingRequest(value: unknown): value is RegenerateHighlightingRequest {
	if (!value || typeof value !== 'object') return false;
	const request = value as Partial<RegenerateHighlightingRequest>;
	return typeof request.repositoryPath === 'string' && typeof request.specificationPath === 'string';
}

function registerDesktopIpc(): void {
	ipcMain.handle('repository:get-state', async () => {
		const state = await repositoryService.getState();
		if (state.status === 'ready') projectService.open(state.repository.path);
		else projectService.close();
		return state;
	});
	ipcMain.handle('repository:open', async (event): Promise<RepositoryState | null> => {
		const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined;
		const selection = parent
			? await dialog.showOpenDialog(parent, {
					properties: ['openDirectory'],
					title: 'Open repository'
				})
			: await dialog.showOpenDialog({ properties: ['openDirectory'], title: 'Open repository' });
		if (selection.canceled || !selection.filePaths[0]) return null;
		const repository = await repositoryService.open(selection.filePaths[0]);
		await repositoryService.saveRecent(repository.path);
		projectService.open(repository.path);
		return { status: 'ready', repository };
	});
	ipcMain.handle('repository:close', () => {
		repositoryService.close();
		projectService.close();
	});
	ipcMain.handle('repository:read-file', (_event, path: unknown) => {
		if (typeof path !== 'string' || path.length === 0) throw new Error('A file path is required.');
		return repositoryService.readFile(path);
	});
	ipcMain.handle('repository:create-file', (_event, request: unknown) => {
		if (!isCreateFileRequest(request) || request.path.trim().length === 0) {
			throw new Error('A valid new file request is required.');
		}
		return repositoryService.createFile(request);
	});
	ipcMain.handle('repository:write-file', (_event, request: unknown) => {
		if (!isSaveFileRequest(request) || request.path.length === 0) {
			throw new Error('A valid file save request is required.');
		}
		return repositoryService.writeFile(request);
	});
	ipcMain.handle('project:get-state', () => projectService.getState());
	ipcMain.handle('project:initialize', () => projectService.initialize());
	ipcMain.handle('project:refresh', () => projectService.refresh());
	ipcMain.handle('project:get-sync-summary', () => projectService.getSyncSummary());
	ipcMain.handle('project:get-review-fixture', (_event, fixture: unknown) => {
		if (fixture !== undefined && (typeof fixture !== 'string' || !REVIEW_FIXTURE_NAMES.includes(fixture as ReviewFixtureName))) {
			throw new Error('An unknown review fixture was requested.');
		}
		return projectService.getReviewFixture(fixture as ReviewFixtureName | undefined);
	});
	ipcMain.handle('project:get-generated-metadata', (_event, specificationPath: unknown) => {
		if (typeof specificationPath !== 'string' || specificationPath.length === 0) {
			throw new Error('A specification path is required.');
		}
		return projectService.getGeneratedMetadata(specificationPath);
	});
	ipcMain.handle('project:regenerate-highlighting', (_event, request: unknown) => {
		if (!repositoryService.root || !isRegenerateHighlightingRequest(request) ||
			request.repositoryPath !== repositoryService.root || request.specificationPath.length === 0) {
			throw new Error('A valid highlighting request for the open repository is required.');
		}
		return projectService.regenerateHighlighting(request.specificationPath);
	});
}

function createWindow(): void {
	const window = new BrowserWindow({
		width: 1440,
		height: 900,
		minWidth: 900,
		minHeight: 600,
		show: false,
		backgroundColor: '#09090b',
		webPreferences: {
			preload: join(currentDirectory, '../preload/index.cjs'),
			contextIsolation: true,
			nodeIntegration: false
		}
	});

	window.once('ready-to-show', () => window.show());

	window.webContents.setWindowOpenHandler(({ url }) => {
		void shell.openExternal(url);
		return { action: 'deny' };
	});

	const rendererUrl = process.env.ELECTRON_RENDERER_URL;
	if (rendererUrl) {
		void window.loadURL(rendererUrl);
	} else {
		void window.loadFile(join(currentDirectory, '../renderer/index.html'));
	}
}

app.whenReady().then(() => {
	registerDesktopIpc();
	createWindow();

	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});

app.on('window-all-closed', () => {
	repositoryService.close();
	projectService.close();
	if (process.platform !== 'darwin') app.quit();
});
