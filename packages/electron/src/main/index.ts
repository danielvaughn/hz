import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { lstat, mkdir, readFile, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
	FilePreview,
	Repository,
	RepositoryState,
	RepositoryTreeNode
} from '../shared/desktop';

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
	repositoryRoot = resolvedPath;
	return {
		name: basename(resolvedPath),
		path: resolvedPath,
		tree: await listDirectory(resolvedPath)
	};
}

async function getRepositoryState(): Promise<RepositoryState> {
	const { recentRepository } = await readSettings();
	if (!recentRepository) return { status: 'empty' };
	try {
		return { status: 'ready', repository: await loadRepository(recentRepository) };
	} catch {
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
	return { kind: 'text', path, content, size: fileInfo.size };
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
		repositoryRoot = null;
	});
	ipcMain.handle('repository:read-file', (_event, path: unknown) => {
		if (typeof path !== 'string' || path.length === 0) throw new Error('A file path is required.');
		return previewFile(path);
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
	if (process.platform !== 'darwin') app.quit();
});
