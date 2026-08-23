import { watch, type FSWatcher } from 'node:fs';
import { lstat, mkdir, readFile, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import type {
	CreateFileRequest,
	FilePreview,
	Repository,
	RepositoryChange,
	RepositoryState,
	RepositoryTreeNode,
	SaveFileRequest,
	SaveFileResult
} from '../shared/desktop.ts';
import { atomicSaveText, contentRevision } from './atomic-save.ts';

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

type DesktopSettings = { recentRepository?: string };

export class RepositoryService {
	private rootPath: string | null = null;
	private watcher: FSWatcher | null = null;
	private watcherTimer: NodeJS.Timeout | null = null;
	private watcherGeneration = 0;
	private readonly pendingWatcherPaths = new Set<string>();
	private readonly internalWrites = new Map<string, number>();
	private readonly settingsPath: () => string;
	private readonly onChange: (change: RepositoryChange) => void;
	private readonly onFilesystemSettled: (delayMs?: number) => void;

	constructor(
		settingsPath: () => string,
		onChange: (change: RepositoryChange) => void = () => {},
		onFilesystemSettled: (delayMs?: number) => void = () => {}
	) {
		this.settingsPath = settingsPath;
		this.onChange = onChange;
		this.onFilesystemSettled = onFilesystemSettled;
	}

	get root(): string | null {
		return this.rootPath;
	}

	async getState(): Promise<RepositoryState> {
		const { recentRepository } = await this.readSettings();
		if (!recentRepository) return { status: 'empty' };
		try {
			return { status: 'ready', repository: await this.open(recentRepository) };
		} catch {
			this.close();
			return { status: 'missing', path: recentRepository };
		}
	}

	async open(path: string): Promise<Repository> {
		const resolvedPath = await realpath(path);
		const info = await stat(resolvedPath);
		if (!info.isDirectory()) throw new Error('The selected path is not a directory.');
		const tree = await this.listDirectory(resolvedPath);
		this.rootPath = resolvedPath;
		this.startWatcher(resolvedPath);
		return {
			name: basename(resolvedPath),
			path: resolvedPath,
			tree
		};
	}

	close(): void {
		this.stopWatcher();
		this.rootPath = null;
	}

	async saveRecent(path: string): Promise<void> {
		const target = this.settingsPath();
		const temporary = `${target}.tmp`;
		await mkdir(dirname(target), { recursive: true });
		await writeFile(temporary, `${JSON.stringify({ recentRepository: path }, null, 2)}\n`, 'utf8');
		await rename(temporary, target);
	}

	readFile(path: string): Promise<FilePreview> {
		return this.previewFile(path);
	}

	async createFile(request: CreateFileRequest): Promise<Extract<FilePreview, { kind: 'text' }>> {
		if (!this.rootPath || request.repositoryPath !== this.rootPath) {
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

		const target = this.resolveRepositoryPath(path);
		const normalizedPath = relative(this.rootPath, target).split(sep).join('/');
		if (!normalizedPath) throw new Error('Enter a file path including its name.');
		if (!TEXT_EXTENSIONS.has(extname(normalizedPath).toLowerCase())) {
			throw new Error('Only supported text file types can be created in Huzzah.');
		}
		const parent = dirname(target);
		let existingAncestor = parent;
		while (existingAncestor !== this.rootPath) {
			try {
				await lstat(existingAncestor);
				break;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
				existingAncestor = dirname(existingAncestor);
			}
		}
		const canonicalAncestor = await realpath(existingAncestor);
		if (!this.isInsideRepository(canonicalAncestor)) {
			throw new Error('The requested file resolves outside the repository.');
		}
		const ancestorInfo = await lstat(canonicalAncestor);
		if (!ancestorInfo.isDirectory()) throw new Error('A parent path is not a directory.');

		await mkdir(parent, { recursive: true });
		const canonicalParent = await realpath(parent);
		if (!this.isInsideRepository(canonicalParent)) {
			throw new Error('The requested file resolves outside the repository.');
		}
		const canonicalParts = relative(this.rootPath, canonicalParent).split(sep);
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
		const preview = await this.previewFile(normalizedPath);
		if (preview.kind !== 'text') throw new Error('The new file type is not editable.');
		this.onFilesystemSettled(0);
		return preview;
	}

	async writeFile(request: SaveFileRequest): Promise<SaveFileResult> {
		if (!this.rootPath || request.repositoryPath !== this.rootPath) {
			throw new Error('The repository changed before this file could be saved.');
		}
		const target = this.resolveRepositoryPath(request.path);
		let disk: FilePreview | null;
		try {
			disk = await this.previewFile(request.path);
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
				beforeRename: () => this.internalWrites.set(request.path, Date.now() + 1000)
			});
		} catch (error) {
			this.internalWrites.delete(request.path);
			throw error;
		}
		if (result.status === 'conflict') {
			try { disk = await this.previewFile(request.path); } catch { disk = null; }
			return { status: 'conflict', disk };
		}
		const preview = await this.previewFile(request.path);
		if (preview.kind !== 'text') throw new Error('The saved file could not be read back as text.');
		this.onFilesystemSettled();
		return { status: 'saved', preview };
	}

	private async readSettings(): Promise<DesktopSettings> {
		try {
			return JSON.parse(await readFile(this.settingsPath(), 'utf8')) as DesktopSettings;
		} catch {
			return {};
		}
	}

	private async listDirectory(root: string, directory = root): Promise<RepositoryTreeNode[]> {
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
						children: await this.listDirectory(root, absolutePath)
					};
				}
				return { name: entry.name, path: relativePath, type: 'file' };
			})
		);
	}

	private stopWatcher(): void {
		this.watcherGeneration += 1;
		this.watcher?.close();
		this.watcher = null;
		if (this.watcherTimer) clearTimeout(this.watcherTimer);
		this.watcherTimer = null;
		this.pendingWatcherPaths.clear();
		this.internalWrites.clear();
	}

	private startWatcher(root: string): void {
		this.stopWatcher();
		const generation = this.watcherGeneration;
		this.watcher = watch(root, { recursive: true }, (_eventType, filename) => {
			if (generation !== this.watcherGeneration || this.rootPath !== root) return;
			const path = this.normalizeWatcherPath(filename);
			const pathParts = path?.split('/') ?? [];
			if (pathParts.includes('.git')) {
				this.onFilesystemSettled();
				return;
			}
			if (pathParts.some((part) => SKIPPED_DIRECTORIES.has(part))) return;
			if (path?.split('/').some((part) => part.startsWith('.huzzah-save-'))) return;
			if (path) {
				const suppressedUntil = this.internalWrites.get(path);
				if (suppressedUntil && suppressedUntil > Date.now()) return;
				this.internalWrites.delete(path);
				this.pendingWatcherPaths.add(path);
			}
			if (this.watcherTimer) clearTimeout(this.watcherTimer);
			this.watcherTimer = setTimeout(() => void this.flushWatcherChanges(root, generation), 120);
		});
		this.watcher.on('error', () => {
			// Individual reads and writes still report actionable errors if watching becomes unavailable.
		});
	}

	private normalizeWatcherPath(path: string | Buffer | null): string | null {
		if (!path) return null;
		const value = path.toString().split(sep).join('/');
		if (!value || value.startsWith('../') || isAbsolute(value)) return null;
		return value;
	}

	private async flushWatcherChanges(root: string, generation: number): Promise<void> {
		this.watcherTimer = null;
		if (generation !== this.watcherGeneration || this.rootPath !== root) return;
		const paths = [...this.pendingWatcherPaths];
		this.pendingWatcherPaths.clear();
		try {
			this.onChange({ repositoryPath: root, kind: 'tree', tree: await this.listDirectory(root) });
		} catch {
			return;
		}
		for (const path of paths) {
			let change: 'changed' | 'deleted' = 'changed';
			try {
				await lstat(this.resolveRepositoryPath(path));
			} catch {
				change = 'deleted';
			}
			this.onChange({ repositoryPath: root, kind: 'file', path, change });
		}
		this.onFilesystemSettled();
	}

	private resolveRepositoryPath(path: string): string {
		if (!this.rootPath) throw new Error('Open a repository before reading files.');
		if (isAbsolute(path)) throw new Error('File paths must be relative to the repository.');
		const target = resolve(this.rootPath, path);
		const relativePath = relative(this.rootPath, target);
		if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
			throw new Error('The requested file is outside the repository.');
		}
		return target;
	}

	private isInsideRepository(path: string): boolean {
		if (!this.rootPath) return false;
		const relativePath = relative(this.rootPath, path);
		return relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath);
	}

	private async previewFile(path: string): Promise<FilePreview> {
		const target = this.resolveRepositoryPath(path);
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
		if (!this.isInsideRepository(canonicalTarget)) {
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
}
