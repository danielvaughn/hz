import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { watch, type FSWatcher } from 'node:fs';
import { lstat, mkdir, readFile, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
	CreateFileRequest,
	FilePreview,
	Repository,
	RepositoryChange,
	RepositoryState,
	RepositoryTreeNode,
	SaveFileRequest,
	SaveFileResult,
	HuzzahProjectState,
	RegenerateHighlightingRequest
} from '../shared/desktop';
import { atomicSaveText, contentRevision } from './atomic-save';
import { ProjectService } from './project-service';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const SETTINGS_FILE = 'desktop-settings.json';
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules']);
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;
const TEXT_EXTENSIONS = new Set([
	'',
	'.c',
	'.cc',
	'.conf',
	'.cpp',
	'.css',
	'.csv',
	'.env',
	'.go',
	'.h',
	'.hpp',
	'.html',
	'.hz',
	'.ini',
	'.java',
	'.js',
	'.json',
	'.jsx',
	'.log',
	'.md',
	'.mjs',
	'.py',
	'.rb',
	'.rs',
	'.scss',
	'.sh',
	'.sql',
	'.svelte',
	'.svg',
	'.toml',
	'.ts',
	'.tsx',
	'.txt',
	'.vue',
	'.xml',
	'.yaml',
	'.yml',
	'.zsh'
]);

let repositoryRoot: string | null = null;
let repositoryWatcher: FSWatcher | null = null;
let watcherTimer: NodeJS.Timeout | null = null;
let watcherGeneration = 0;
const pendingWatcherPaths = new Set<string>();
const internalWrites = new Map<string, number>();
const projectService = new ProjectService(emitProjectStateChange);

type DesktopSettings = { recentRepository?: string };

function settingsPath(): string {
	return join(app.getPath('userData'), SETTINGS_FILE);
}

async function readSettings(): Promise<DesktopSettings> {
	try {
		return JSON.parse(await readFile(settingsPath(), 'utf8')) as DesktopSettings;
	} catch {
		return {};
	}
}

async function saveRecentRepository(path: string): Promise<void> {
	const target = settingsPath();
	const temporary = `${target}.tmp`;
	await mkdir(dirname(target), { recursive: true });
	await writeFile(temporary, `${JSON.stringify({ recentRepository: path }, null, 2)}\n`, 'utf8');
	await rename(temporary, target);
}

async function listDirectory(root: string, directory = root): Promise<RepositoryTreeNode[]> {
	const entries = await readdir(directory, { withFileTypes: true });
	const visible = entries.filter(
		(entry) => !(entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name))
	);
	visible.sort((left, right) => {
		if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1;
		return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' });
	});

	return Promise.all(
		visible.map(async (entry): Promise<RepositoryTreeNode> => {
			const absolutePath = join(directory, entry.name);
			const relativePath = relative(root, absolutePath).split(sep).join('/');
			if (entry.isDirectory() && !entry.isSymbolicLink()) {
				return {
					name: entry.name,
					path: relativePath,
					type: 'directory',
					children: await listDirectory(root, absolutePath)
				};
			}
			return { name: entry.name, path: relativePath, type: 'file' };
		})
	);
}

async function loadRepository(path: string): Promise<Repository> {
	const resolvedPath = await realpath(path);
	const info = await stat(resolvedPath);
	if (!info.isDirectory()) throw new Error('The selected path is not a directory.');
	const tree = await listDirectory(resolvedPath);
	repositoryRoot = resolvedPath;
	startRepositoryWatcher(resolvedPath);
	projectService.open(resolvedPath);
	return {
		name: basename(resolvedPath),
		path: resolvedPath,
		tree
	};
}

function stopRepositoryWatcher(): void {
	watcherGeneration += 1;
	repositoryWatcher?.close();
	repositoryWatcher = null;
	if (watcherTimer) clearTimeout(watcherTimer);
	watcherTimer = null;
	pendingWatcherPaths.clear();
	internalWrites.clear();
}

function emitRepositoryChange(change: RepositoryChange): void {
	for (const window of BrowserWindow.getAllWindows()) {
		if (!window.isDestroyed()) window.webContents.send('repository:change', change);
	}
}

function emitProjectStateChange(state: HuzzahProjectState): void {
	for (const window of BrowserWindow.getAllWindows()) {
		if (!window.isDestroyed()) window.webContents.send('project:change', state);
	}
}

function normalizeWatcherPath(path: string | Buffer | null): string | null {
	if (!path) return null;
	const value = path.toString().split(sep).join('/');
	if (!value || value.startsWith('../') || isAbsolute(value)) return null;
	return value;
}

function startRepositoryWatcher(root: string): void {
	stopRepositoryWatcher();
	const generation = watcherGeneration;
	repositoryWatcher = watch(root, { recursive: true }, (_eventType, filename) => {
		if (generation !== watcherGeneration || repositoryRoot !== root) return;
		const path = normalizeWatcherPath(filename);
		const pathParts = path?.split('/') ?? [];
		if (pathParts.includes('.git')) {
			projectService.scheduleRefresh();
			return;
		}
		if (pathParts.some((part) => SKIPPED_DIRECTORIES.has(part))) return;
		if (path?.split('/').some((part) => part.startsWith('.huzzah-save-'))) return;
		if (path) {
			const suppressedUntil = internalWrites.get(path);
			if (suppressedUntil && suppressedUntil > Date.now()) return;
			internalWrites.delete(path);
			pendingWatcherPaths.add(path);
		}
		if (watcherTimer) clearTimeout(watcherTimer);
		watcherTimer = setTimeout(() => void flushWatcherChanges(root, generation), 120);
	});
	repositoryWatcher.on('error', () => {
		// Individual reads and writes still report actionable errors if watching becomes unavailable.
	});
}

async function flushWatcherChanges(root: string, generation: number): Promise<void> {
	watcherTimer = null;
	if (generation !== watcherGeneration || repositoryRoot !== root) return;
	const paths = [...pendingWatcherPaths];
	pendingWatcherPaths.clear();
	try {
		emitRepositoryChange({ repositoryPath: root, kind: 'tree', tree: await listDirectory(root) });
	} catch {
		return;
	}
	for (const path of paths) {
		let change: 'changed' | 'deleted' = 'changed';
		try {
			await lstat(resolveRepositoryPath(path));
		} catch {
			change = 'deleted';
		}
		emitRepositoryChange({ repositoryPath: root, kind: 'file', path, change });
	}
	projectService.scheduleRefresh();
}

async function getRepositoryState(): Promise<RepositoryState> {
	const { recentRepository } = await readSettings();
	if (!recentRepository) return { status: 'empty' };
	try {
		return { status: 'ready', repository: await loadRepository(recentRepository) };
	} catch {
		stopRepositoryWatcher();
		projectService.close();
		repositoryRoot = null;
		return { status: 'missing', path: recentRepository };
	}
}

function resolveRepositoryPath(path: string): string {
	if (!repositoryRoot) throw new Error('Open a repository before reading files.');
	if (isAbsolute(path)) throw new Error('File paths must be relative to the repository.');
	const target = resolve(repositoryRoot, path);
	const relativePath = relative(repositoryRoot, target);
	if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
		throw new Error('The requested file is outside the repository.');
	}
	return target;
}

function isInsideRepository(path: string): boolean {
	if (!repositoryRoot) return false;
	const relativePath = relative(repositoryRoot, path);
	return relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath);
}

async function previewFile(path: string): Promise<FilePreview> {
	const target = resolveRepositoryPath(path);
	const fileInfo = await lstat(target);
	if (fileInfo.isSymbolicLink()) {
		return {
			kind: 'unsupported',
			path,
			content: null,
			size: fileInfo.size,
			reason: 'Symbolic links are visible but are not followed.'
		};
	}
	if (!fileInfo.isFile()) throw new Error('The selected path is not a file.');
	const canonicalTarget = await realpath(target);
	if (!isInsideRepository(canonicalTarget)) {
		throw new Error('The requested file resolves outside the repository.');
	}
	if (fileInfo.size > MAX_PREVIEW_BYTES) {
		return {
			kind: 'unsupported',
			path,
			content: null,
			size: fileInfo.size,
			reason: 'This file is too large to preview safely.'
		};
	}

	const bytes = await readFile(canonicalTarget);
	if (bytes.includes(0)) {
		return {
			kind: 'unsupported',
			path,
			content: null,
			size: fileInfo.size,
			reason: 'Binary files cannot be previewed as text.'
		};
	}
	let content: string;
	try {
		content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		return {
			kind: 'unsupported',
			path,
			content: null,
			size: fileInfo.size,
			reason: 'Binary files cannot be previewed as text.'
		};
	}

	if (!TEXT_EXTENSIONS.has(extname(path).toLowerCase())) {
		return {
			kind: 'unsupported',
			path,
			content,
			size: fileInfo.size,
			reason: 'This file type is shown in plain read-only mode.'
		};
	}
	return { kind: 'text', path, content, size: fileInfo.size, revision: contentRevision(content) };
}

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

async function createFile(request: CreateFileRequest): Promise<Extract<FilePreview, { kind: 'text' }>> {
	if (!repositoryRoot || request.repositoryPath !== repositoryRoot) {
		throw new Error('The repository changed before this file could be created.');
	}
	const path = request.path.trim().split('\\').join('/');
	if (!path || path.endsWith('/')) throw new Error('Enter a file path including its name.');
	const parts = path.split('/');
	if (parts.some((part) => part === '.git' || part === 'node_modules')) {
		throw new Error('Files cannot be created in protected repository directories.');
	}
	if (parts.at(-1)?.startsWith('.huzzah-save-')) {
		throw new Error('That file name is reserved for Huzzah saves.');
	}

	const target = resolveRepositoryPath(path);
	const normalizedPath = relative(repositoryRoot, target).split(sep).join('/');
	if (!normalizedPath) throw new Error('Enter a file path including its name.');
	if (!TEXT_EXTENSIONS.has(extname(normalizedPath).toLowerCase())) {
		throw new Error('Only supported text file types can be created in Huzzah.');
	}
	const parent = dirname(target);
	let existingAncestor = parent;
	while (existingAncestor !== repositoryRoot) {
		try {
			await lstat(existingAncestor);
			break;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
			existingAncestor = dirname(existingAncestor);
		}
	}
	const canonicalAncestor = await realpath(existingAncestor);
	if (!isInsideRepository(canonicalAncestor)) {
		throw new Error('The requested file resolves outside the repository.');
	}
	const ancestorInfo = await lstat(canonicalAncestor);
	if (!ancestorInfo.isDirectory()) throw new Error('A parent path is not a directory.');

	await mkdir(parent, { recursive: true });
	const canonicalParent = await realpath(parent);
	if (!isInsideRepository(canonicalParent)) {
		throw new Error('The requested file resolves outside the repository.');
	}
	const canonicalParts = relative(repositoryRoot, canonicalParent).split(sep);
	if (canonicalParts.some((part) => part === '.git' || part === 'node_modules')) {
		throw new Error('Files cannot be created in protected repository directories.');
	}
	try {
		await writeFile(target, '', { encoding: 'utf8', flag: 'wx' });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
			throw new Error('A file or directory already exists at that path.');
		}
		throw error;
	}
	const preview = await previewFile(normalizedPath);
	if (preview.kind !== 'text') throw new Error('The new file type is not editable.');
	projectService.scheduleRefresh(0);
	return preview;
}

async function saveFile(request: SaveFileRequest): Promise<SaveFileResult> {
	if (!repositoryRoot || request.repositoryPath !== repositoryRoot) {
		throw new Error('The repository changed before this file could be saved.');
	}
	const target = resolveRepositoryPath(request.path);
	let disk: FilePreview | null;
	try {
		disk = await previewFile(request.path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'conflict', disk: null };
		throw error;
	}
	if (disk.kind !== 'text') throw new Error('Only supported text files can be edited.');
	let result;
	try {
		result = await atomicSaveText({
			target,
			content: request.content,
			expectedRevision: request.expectedRevision,
			maxBytes: MAX_PREVIEW_BYTES,
			beforeRename: () => internalWrites.set(request.path, Date.now() + 1000)
		});
	} catch (error) {
		internalWrites.delete(request.path);
		throw error;
	}
	if (result.status === 'conflict') {
		try { disk = await previewFile(request.path); } catch { disk = null; }
		return { status: 'conflict', disk };
	}
	const preview = await previewFile(request.path);
	if (preview.kind !== 'text') throw new Error('The saved file could not be read back as text.');
	projectService.scheduleRefresh();
	return { status: 'saved', preview };
}

function registerDesktopIpc(): void {
	ipcMain.handle('repository:get-state', () => getRepositoryState());
	ipcMain.handle('repository:open', async (event): Promise<RepositoryState | null> => {
		const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined;
		const selection = parent
			? await dialog.showOpenDialog(parent, {
					properties: ['openDirectory'],
					title: 'Open repository'
				})
			: await dialog.showOpenDialog({ properties: ['openDirectory'], title: 'Open repository' });
		if (selection.canceled || !selection.filePaths[0]) return null;
		const repository = await loadRepository(selection.filePaths[0]);
		await saveRecentRepository(repository.path);
		return { status: 'ready', repository };
	});
	ipcMain.handle('repository:close', () => {
		stopRepositoryWatcher();
		projectService.close();
		repositoryRoot = null;
	});
	ipcMain.handle('repository:read-file', (_event, path: unknown) => {
		if (typeof path !== 'string' || path.length === 0) throw new Error('A file path is required.');
		return previewFile(path);
	});
	ipcMain.handle('repository:create-file', (_event, request: unknown) => {
		if (!isCreateFileRequest(request) || request.path.trim().length === 0) {
			throw new Error('A valid new file request is required.');
		}
		return createFile(request);
	});
	ipcMain.handle('repository:write-file', (_event, request: unknown) => {
		if (!isSaveFileRequest(request) || request.path.length === 0) {
			throw new Error('A valid file save request is required.');
		}
		return saveFile(request);
	});
	ipcMain.handle('project:get-state', () => projectService.getState());
	ipcMain.handle('project:initialize', () => projectService.initialize());
	ipcMain.handle('project:refresh', () => projectService.refresh());
	ipcMain.handle('project:get-sync-summary', () => projectService.getSyncSummary());
	ipcMain.handle('project:get-generated-metadata', (_event, specificationPath: unknown) => {
		if (typeof specificationPath !== 'string' || specificationPath.length === 0) {
			throw new Error('A specification path is required.');
		}
		return projectService.getGeneratedMetadata(specificationPath);
	});
	ipcMain.handle('project:regenerate-highlighting', (_event, request: unknown) => {
		if (!repositoryRoot || !isRegenerateHighlightingRequest(request) || request.repositoryPath !== repositoryRoot ||
			request.specificationPath.length === 0) {
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
	stopRepositoryWatcher();
	projectService.close();
	if (process.platform !== 'darwin') app.quit();
});
