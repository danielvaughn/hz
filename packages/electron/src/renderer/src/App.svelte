<script lang="ts">
	import { onMount, tick } from 'svelte';
	import type {
		FilePreview,
		GeneratedMetadataState,
		HuzzahProjectState,
		InferenceModel,
		InferenceUsage,
		RepositoryChange,
		RepositoryState,
		RepositoryTreeNode,
		SpecificationChange,
		SyncSummary
	} from '../../shared/desktop';
	import CodeViewer from './CodeViewer.svelte';

	type TextPreview = Extract<FilePreview, { kind: 'text' }>;
	type OpenTab = {
		path: string;
		name: string;
		state: 'loading' | 'ready' | 'error';
		preview?: FilePreview;
		buffer?: string;
		error?: string;
		dirty?: boolean;
		saving?: boolean;
		saveError?: string;
		conflict?: FilePreview | null;
		metadata?: GeneratedMetadataState;
		metadataLoading?: boolean;
		metadataRequest?: number;
		highlighting?: {
			status: 'running' | 'complete' | 'error';
			model?: InferenceModel;
			usage?: InferenceUsage;
			error?: string;
		};
	};
	type VisibleNode = RepositoryTreeNode & { depth: number };

	let repositoryState = $state<RepositoryState>({ status: 'empty' });
	let loadingRepository = $state(true);
	let repositoryError = $state('');
	let tabs = $state<OpenTab[]>([]);
	let activePath = $state<string | null>(null);
	let expandedPaths = $state(new Set<string>());
	let projectState = $state<HuzzahProjectState | null>(null);
	let projectActionError = $state('');
	let initializingProject = $state(false);
	let loadingSyncSummary = $state(false);
	let syncSummary = $state<SyncSummary | null>(null);
	let newFileOpen = $state(false);
	let newFilePath = $state('');
	let newFileError = $state('');
	let creatingFile = $state(false);
	let commandPaletteOpen = $state(false);
	let fileMenu = $state<{ path: string; x: number; y: number } | null>(null);
	let metadataRequest = 0;

	let repository = $derived(repositoryState.status === 'ready' ? repositoryState.repository : null);
	let activeTab = $derived(tabs.find((tab) => tab.path === activePath) ?? null);
	let visibleNodes = $derived(flattenTree(repository?.tree ?? [], expandedPaths));
	let shortcutKey = $derived(window.desktop.platform === 'darwin' ? '⌘' : 'Ctrl');
	let specificationChanges = $derived(projectState?.git.status === 'ready' ? projectState.git.changes : []);
	let canSync = $derived(projectState?.config.status === 'ready' && projectState?.git.status === 'ready' && specificationChanges.length > 0);

	function flattenTree(nodes: RepositoryTreeNode[], expanded: Set<string>, depth = 0): VisibleNode[] {
		return nodes.flatMap((node) => {
			const visible: VisibleNode[] = [{ ...node, depth }];
			if (node.type === 'directory' && expanded.has(node.path) && node.children) visible.push(...flattenTree(node.children, expanded, depth + 1));
			return visible;
		});
	}

	function errorMessage(error: unknown): string {
		return error instanceof Error ? error.message : 'An unexpected desktop error occurred.';
	}

	function applyRepositoryState(nextState: RepositoryState): void {
		repositoryState = nextState;
		repositoryError = '';
		if (nextState.status === 'ready') {
			newFileOpen = false;
			syncSummary = null;
			tabs = [];
			activePath = null;
			expandedPaths = new Set(nextState.repository.tree.filter((node) => node.type === 'directory').slice(0, 2).map((node) => node.path));
			projectState = null;
			void loadProjectState(nextState.repository.path);
		}
	}

	async function loadProjectState(repositoryPath: string): Promise<void> {
		try {
			const state = await window.desktop.getProjectState();
			if (state?.repositoryPath === repositoryPath && repository?.path === repositoryPath) {
				projectState = state;
				void refreshOpenMetadata();
			}
		} catch (error) {
			projectActionError = errorMessage(error);
		}
	}

	function confirmDiscardChanges(scope: string, candidates = tabs): boolean {
		if (candidates.some((tab) => tab.saving)) {
			window.alert('A file save is still in progress. Try again when it finishes.');
			return false;
		}
		const changed = candidates.filter((tab) => tab.dirty || tab.conflict !== undefined || !!tab.saveError);
		if (changed.length === 0) return true;
		return window.confirm(`Discard unsaved changes ${scope}?`);
	}

	async function chooseRepository(): Promise<void> {
		if (loadingRepository || !confirmDiscardChanges('before opening another repository')) return;
		loadingRepository = true;
		repositoryError = '';
		try {
			const nextState = await window.desktop.openRepository();
			if (nextState) applyRepositoryState(nextState);
		} catch (error) {
			repositoryError = errorMessage(error);
		} finally {
			loadingRepository = false;
		}
	}

	async function closeRepository(): Promise<void> {
		if (!confirmDiscardChanges('and close this repository')) return;
		try {
			await window.desktop.closeRepository();
			repositoryState = { status: 'empty' };
			projectState = null;
			syncSummary = null;
			newFileOpen = false;
			tabs = [];
			activePath = null;
			expandedPaths = new Set();
			repositoryError = '';
		} catch (error) {
			repositoryError = errorMessage(error);
		}
	}

	function suggestedFilePath(): string {
		if (projectState?.config.status === 'ready' && projectState.config.specifications.length === 0) {
			return `${projectState.config.specDirectory}/untitled.hz`;
		}
		const directory = activePath?.split('/').slice(0, -1).join('/') ?? '';
		const extension = activePath?.toLowerCase().endsWith('.hz') ? '.hz' : '.txt';
		return `${directory ? `${directory}/` : ''}untitled${extension}`;
	}

	function showNewFile(): void {
		newFilePath = suggestedFilePath();
		newFileError = '';
		newFileOpen = true;
		void tick().then(() => {
			const input = document.querySelector<HTMLInputElement>('#new-file-path');
			input?.focus();
			input?.select();
		});
	}

	async function submitNewFile(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (!repository || creatingFile || !newFilePath.trim()) return;
		creatingFile = true;
		newFileError = '';
		try {
			const preview = await window.desktop.createFile({
				repositoryPath: repository.path,
				path: newFilePath
			});
			const pathParts = preview.path.split('/');
			const directories = pathParts.slice(0, -1).map((_, index) => pathParts.slice(0, index + 1).join('/'));
			expandedPaths = new Set([...expandedPaths, ...directories]);
			tabs = [...tabs, {
				path: preview.path,
				name: pathParts.at(-1) ?? preview.path,
				state: 'ready',
				preview,
				buffer: preview.content,
				dirty: false
			}];
			activePath = preview.path;
			newFileOpen = false;
		} catch (error) {
			newFileError = errorMessage(error);
		} finally {
			creatingFile = false;
		}
	}

	async function initializeProject(): Promise<void> {
		if (!repository || initializingProject) return;
		initializingProject = true;
		projectActionError = '';
		try {
			projectState = await window.desktop.initializeProject();
		} catch (error) {
			projectActionError = errorMessage(error);
		} finally {
			initializingProject = false;
		}
	}

	async function openSyncSummary(): Promise<void> {
		if (!canSync || loadingSyncSummary) return;
		if (tabs.some((tab) => tab.dirty || tab.saving || tab.conflict !== undefined)) {
			projectActionError = 'Save or resolve all open file changes before reviewing synchronization.';
			return;
		}
		loadingSyncSummary = true;
		projectActionError = '';
		try {
			syncSummary = await window.desktop.getSyncSummary();
		} catch (error) {
			projectActionError = errorMessage(error);
		} finally {
			loadingSyncSummary = false;
		}
	}

	function projectStatus(): string {
		if (projectActionError) return projectActionError;
		if (!projectState) return 'READING HUZZAH PROJECT';
		if (projectState.config.status === 'loading') return 'READING HUZZAH PROJECT';
		if (projectState.config.status === 'missing') return 'HUZZAH NOT INITIALIZED';
		if (projectState.config.status === 'invalid') return `CONFIG ERROR · ${projectState.config.message}`;
		const git = projectState.git;
		if (git.status === 'loading') return 'READING GIT STATUS';
		if (git.status === 'not-repository') return 'NOT A GIT REPOSITORY';
		if (git.status === 'wrong-root') return `OPEN GIT ROOT · ${git.repositoryRoot}`;
		if (git.status === 'missing-head') return 'GIT REPOSITORY HAS NO HEAD';
		if (git.status === 'unavailable') return 'GIT IS UNAVAILABLE';
		if (git.status === 'error') return `GIT ERROR · ${git.message}`;
		return `${projectState.config.specifications.length} SPEC${projectState.config.specifications.length === 1 ? '' : 'S'} · ${git.changes.length} CHANGED`;
	}

	function projectHasProblem(): boolean {
		return !!projectActionError || projectState?.config.status === 'invalid' ||
			(projectState?.git.status !== undefined && !['loading', 'ready'].includes(projectState.git.status));
	}

	function changeLabel(change: SpecificationChange): string {
		return change.kind.toUpperCase();
	}

	function toggleDirectory(path: string): void {
		const next = new Set(expandedPaths);
		if (next.has(path)) next.delete(path);
		else next.add(path);
		expandedPaths = next;
	}

	function isSpecification(path: string): boolean {
		return projectState?.config.status === 'ready' && projectState.config.specifications.includes(path);
	}

	async function loadTabMetadata(path: string): Promise<void> {
		if (!isSpecification(path) || !tabs.some((tab) => tab.path === path)) return;
		const request = ++metadataRequest;
		tabs = tabs.map((tab) => tab.path === path ? { ...tab, metadataLoading: true, metadataRequest: request } : tab);
		try {
			const metadata = await window.desktop.getGeneratedMetadata(path);
			tabs = tabs.map((tab) => tab.path === path && tab.metadataRequest === request
				? { ...tab, metadata: tab.dirty ? staleMetadata(metadata) : metadata, metadataLoading: false }
				: tab);
		} catch {
			tabs = tabs.map((tab) => tab.path === path && tab.metadataRequest === request ? { ...tab, metadataLoading: false } : tab);
		}
	}

	async function regenerateHighlighting(path: string): Promise<void> {
		if (!repository || !isSpecification(path)) return;
		fileMenu = null;
		commandPaletteOpen = false;
		const tab = tabs.find((candidate) => candidate.path === path);
		if (!tab || tab.preview?.kind !== 'text' || tab.conflict !== undefined) return;
		if (tab.dirty && !(await saveTab(path))) return;
		tabs = tabs.map((candidate) => candidate.path === path
			? { ...candidate, highlighting: { status: 'running' } }
			: candidate);
		try {
			const result = await window.desktop.regenerateHighlighting({
				repositoryPath: repository.path,
				specificationPath: path
			});
			tabs = tabs.map((candidate) => candidate.path === path ? {
				...candidate,
				metadata: result.metadata,
				metadataLoading: false,
				highlighting: { status: 'complete', model: result.model, usage: result.usage }
			} : candidate);
		} catch (error) {
			tabs = tabs.map((candidate) => candidate.path === path
				? { ...candidate, highlighting: { status: 'error', error: errorMessage(error) } }
				: candidate);
		}
	}

	async function regenerateFromFileMenu(path: string): Promise<void> {
		fileMenu = null;
		let tab = tabs.find((candidate) => candidate.path === path);
		if (!tab) {
			const node = findFileNode(repository?.tree ?? [], path);
			if (!node) return;
			await openFile(node);
			tab = tabs.find((candidate) => candidate.path === path);
		}
		if (tab) {
			activePath = path;
			await regenerateHighlighting(path);
		}
	}

	function findFileNode(nodes: RepositoryTreeNode[], path: string): RepositoryTreeNode | null {
		for (const node of nodes) {
			if (node.type === 'file' && node.path === path) return node;
			if (node.type === 'directory') {
				const match = findFileNode(node.children ?? [], path);
				if (match) return match;
			}
		}
		return null;
	}

	function openFileMenu(event: MouseEvent, node: RepositoryTreeNode): void {
		if (node.type !== 'file') return;
		event.preventDefault();
		fileMenu = { path: node.path, x: event.clientX, y: event.clientY };
	}

	function usageLabel(usage: InferenceUsage): string {
		return `${usage.tokens.total.toLocaleString()} TOKENS · $${usage.estimatedCostUsd.toFixed(4)}`;
	}

	async function refreshOpenMetadata(): Promise<void> {
		await Promise.all(tabs.filter((tab) => isSpecification(tab.path)).map((tab) => loadTabMetadata(tab.path)));
	}

	function staleMetadata(metadata: GeneratedMetadataState | undefined): GeneratedMetadataState | undefined {
		if (!metadata || metadata.artifactStatus !== 'ready') return metadata;
		return {
			...metadata,
			highlighting: metadata.highlighting.status === 'current' ? { status: 'stale' } : metadata.highlighting,
			sourceMaps: metadata.sourceMaps.map((target) => target.status === 'current'
				? { path: target.path, status: 'stale' }
				: target)
		};
	}

	async function openFile(node: RepositoryTreeNode): Promise<void> {
		if (node.type !== 'file') return;
		if (tabs.some((tab) => tab.path === node.path)) { activePath = node.path; return; }
		tabs = [...tabs, { path: node.path, name: node.name, state: 'loading' }];
		activePath = node.path;
		try {
			const preview = await window.desktop.readFile(node.path);
			tabs = tabs.map((tab) => tab.path === node.path ? { ...tab, state: 'ready', preview, buffer: preview.kind === 'text' ? preview.content : undefined } : tab);
			void loadTabMetadata(node.path);
		} catch (error) {
			tabs = tabs.map((tab) => tab.path === node.path ? { ...tab, state: 'error', error: errorMessage(error) } : tab);
		}
	}

	function editFile(path: string, content: string): void {
		const tab = tabs.find((candidate) => candidate.path === path);
		if (!tab || tab.preview?.kind !== 'text' || tab.conflict !== undefined) return;
		const dirty = content !== tab.preview.content;
		tabs = tabs.map((candidate) => candidate.path === path ? {
			...candidate,
			buffer: content,
			dirty,
			saveError: undefined,
			metadata: dirty ? staleMetadata(candidate.metadata) : candidate.metadata
		} : candidate);
		if (!dirty && isSpecification(path)) void loadTabMetadata(path);
	}

	async function saveTab(path: string): Promise<boolean> {
		const tab = tabs.find((candidate) => candidate.path === path);
		if (tab?.saving) return false;
		if (!tab?.dirty) return !tab?.conflict && !tab?.saveError;
		if (!repository || tab.preview?.kind !== 'text' || tab.buffer === undefined || tab.conflict !== undefined) return false;
		const content = tab.buffer;
		const expectedRevision = tab.preview.revision;
		tabs = tabs.map((candidate) => candidate.path === path ? { ...candidate, saving: true, saveError: undefined } : candidate);
		try {
			const result = await window.desktop.writeFile({ repositoryPath: repository.path, path, content, expectedRevision });
			if (result.status === 'conflict') {
				tabs = tabs.map((candidate) => candidate.path === path ? { ...candidate, saving: false, dirty: true, conflict: result.disk } : candidate);
				return false;
			}
			tabs = tabs.map((candidate) => {
				if (candidate.path !== path) return candidate;
				const dirty = candidate.buffer !== content;
				return { ...candidate, preview: result.preview, saving: false, dirty, saveError: undefined };
			});
			void refreshOpenMetadata();
			return true;
		} catch (error) {
			tabs = tabs.map((candidate) => candidate.path === path ? { ...candidate, saving: false, dirty: true, saveError: errorMessage(error) } : candidate);
			return false;
		}
	}

	async function closeTab(event: MouseEvent, path: string): Promise<void> {
		event.stopPropagation();
		const originalIndex = tabs.findIndex((tab) => tab.path === path);
		const tab = tabs[originalIndex];
		if (!tab || tab.saving || !confirmDiscardChanges(`in ${tab.name}`, [tab])) return;
		const wasActive = activePath === path;
		tabs = tabs.filter((tab) => tab.path !== path);
		if (wasActive) activePath = tabs[Math.min(originalIndex, tabs.length - 1)]?.path ?? null;
	}

	async function handleRepositoryChange(change: RepositoryChange): Promise<void> {
		if (!repository || change.repositoryPath !== repository.path) return;
		if (change.kind === 'tree') {
			const filePaths = new Set(collectFilePaths(change.tree));
			tabs = tabs.map((tab) => {
				if (filePaths.has(tab.path) || tab.state === 'loading') return tab;
				if (tab.dirty || tab.saving) return { ...tab, conflict: null, dirty: true };
				return { ...tab, state: 'error', error: 'This file was renamed or deleted outside Huzzah.' };
			});
			repositoryState = { status: 'ready', repository: { ...repository, tree: change.tree } };
			void refreshOpenMetadata();
			return;
		}
		void refreshOpenMetadata();
		const tab = tabs.find((candidate) => candidate.path === change.path);
		if (!tab || tab.preview?.kind !== 'text') return;
		let disk: FilePreview | null = null;
		if (change.change !== 'deleted') {
			try { disk = await window.desktop.readFile(change.path); } catch { disk = null; }
		}
		const current = tabs.find((candidate) => candidate.path === change.path);
		if (!current) return;
		if (current.dirty || current.saving) {
			tabs = tabs.map((candidate) => candidate.path === change.path ? { ...candidate, conflict: disk, dirty: true } : candidate);
			return;
		}
		if (disk?.kind === 'text') {
			tabs = tabs.map((candidate) => candidate.path === change.path ? { ...candidate, preview: disk as TextPreview, buffer: disk.content, dirty: false, saveError: undefined } : candidate);
		} else {
			tabs = tabs.map((candidate) => candidate.path === change.path ? { ...candidate, state: 'error', error: change.change === 'deleted' ? 'This file was deleted outside Huzzah.' : 'This file is no longer editable text.' } : candidate);
		}
	}

	function collectFilePaths(nodes: RepositoryTreeNode[]): string[] {
		return nodes.flatMap((node) => node.type === 'file' ? [node.path] : collectFilePaths(node.children ?? []));
	}

	function useDiskVersion(path: string): void {
		const tab = tabs.find((candidate) => candidate.path === path);
		if (tab?.conflict?.kind !== 'text') return;
		const disk = tab.conflict;
		tabs = tabs.map((candidate) => candidate.path === path ? { ...candidate, preview: disk, buffer: disk.content, conflict: undefined, dirty: false, saveError: undefined } : candidate);
		void loadTabMetadata(path);
	}

	function keepLocalVersion(path: string): void {
		const tab = tabs.find((candidate) => candidate.path === path);
		if (tab?.conflict?.kind !== 'text') return;
		const disk = tab.conflict;
		tabs = tabs.map((candidate) => candidate.path === path ? { ...candidate, preview: disk, conflict: undefined, dirty: true, saveError: undefined } : candidate);
		void saveTab(path);
	}

	function retrySave(path: string): void { void saveTab(path); }
	function formatBytes(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}
	function displayPath(path: string): string { return path.split('/').slice(0, -1).join('/') || 'repository root'; }
	function tabStatus(tab: OpenTab): string {
		if (tab.conflict !== undefined) return 'CONFLICT';
		if (tab.saveError) return 'SAVE FAILED';
		if (tab.saving) return 'SAVING…';
		if (tab.dirty) return 'EDITED';
		return tab.preview?.kind === 'text' ? 'SAVED' : 'READ ONLY';
	}
	function metadataStatus(tab: OpenTab): string | null {
		if (!isSpecification(tab.path)) return null;
		if (tab.metadataLoading && !tab.metadata) return 'METADATA…';
		if (!tab.metadata || tab.metadata.artifactStatus === 'missing') return 'METADATA MISSING';
		if (tab.metadata.artifactStatus === 'invalid') return 'METADATA INVALID';
		const statuses = [tab.metadata.highlighting.status, ...tab.metadata.sourceMaps.map((target) => target.status)];
		if (tab.dirty || statuses.includes('stale')) return 'METADATA STALE';
		if (statuses.includes('invalid')) return 'METADATA INVALID';
		if (tab.metadata.sourceMaps.some((target) => target.status === 'missing')) return 'MAP TARGET MISSING';
		if (tab.metadata.highlighting.status === 'missing') return 'HIGHLIGHTING MISSING';
		return 'METADATA CURRENT';
	}

	onMount(() => {
		const handleKeydown = (event: KeyboardEvent) => {
			if (event.key === 'Escape' && commandPaletteOpen) { commandPaletteOpen = false; return; }
			if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'p') {
				event.preventDefault(); commandPaletteOpen = true; fileMenu = null; return;
			}
			if (event.key === 'Escape' && newFileOpen) { newFileOpen = false; return; }
			if (event.key === 'Escape' && syncSummary) { syncSummary = null; return; }
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'o') { event.preventDefault(); void chooseRepository(); }
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'w' && activePath) { event.preventDefault(); void closeTab(new MouseEvent('click'), activePath); }
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's' && activePath) { event.preventDefault(); void saveTab(activePath); }
		};
		const closeFileMenu = () => { fileMenu = null; };
		window.addEventListener('keydown', handleKeydown);
		window.addEventListener('click', closeFileMenu);
		const unsubscribe = window.desktop.onRepositoryChange((change) => void handleRepositoryChange(change));
		const unsubscribeProject = window.desktop.onProjectStateChange((state) => {
			if (repository?.path === state.repositoryPath) {
				projectState = state;
				projectActionError = '';
				void refreshOpenMetadata();
			}
		});
		void window.desktop.getRepositoryState().then(applyRepositoryState).catch((error) => {
			repositoryError = errorMessage(error);
			repositoryState = { status: 'empty' };
		}).finally(() => { loadingRepository = false; });
		return () => { window.removeEventListener('keydown', handleKeydown); window.removeEventListener('click', closeFileMenu); unsubscribe(); unsubscribeProject(); };
	});
</script>

<svelte:head><title>{repository ? `${repository.name} — Huzzah` : 'Huzzah'}</title></svelte:head>

<main class="app-shell">
	<header class="titlebar">
		<div class="wordmark" aria-label="Huzzah"><span class="wordmark-mark">H</span><span class="wordmark-name">HUZZAH</span><span class="phase-label">LOCAL EDITOR</span></div>
		<div class="repository-identity">
			{#if repository}<span class="status-dot" aria-hidden="true"></span><div><strong>{repository.name}</strong><span>{repository.path}</span></div>{:else}<span>NO REPOSITORY OPEN</span>{/if}
		</div>
		<div class="repository-actions">
			{#if repository}<button class="project-button new-file-button" onclick={showNewFile}>+ NEW FILE</button>{/if}
			{#if repository && projectState?.config.status === 'missing'}<button class="project-button initialize-button" onclick={initializeProject} disabled={initializingProject}>{initializingProject ? 'INITIALIZING…' : 'INITIALIZE'}</button>{/if}
			{#if repository}<button class="project-button sync-button" class:available={canSync} onclick={openSyncSummary} disabled={!canSync || loadingSyncSummary}>{loadingSyncSummary ? 'CHECKING…' : 'SYNC'}{#if specificationChanges.length > 0}<span>{specificationChanges.length}</span>{/if}</button>{/if}
			{#if repository}<button class="close-repository-button" onclick={closeRepository}>CLOSE</button>{/if}
			<button class="open-button" onclick={chooseRepository} disabled={loadingRepository}>
				<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.5 5.5h5l1.6 2h8.4v7.3a1.7 1.7 0 0 1-1.7 1.7H4.2a1.7 1.7 0 0 1-1.7-1.7V5.5Zm0 2h15M4.5 5.5V4.2c0-.4.3-.7.7-.7h4.1l1.5 2" /></svg>
				{loadingRepository ? 'OPENING…' : 'OPEN REPOSITORY'}<kbd>{shortcutKey}O</kbd>
			</button>
		</div>
	</header>

	{#if repositoryState.status === 'ready' && repository}
		<div class="workspace">
			<aside class="sidebar">
				<div class="panel-heading"><div><span>FILES</span><strong>{repository.name}</strong></div><span class="file-count">{visibleNodes.filter((node) => node.type === 'file').length}</span></div>
				<div class:problem={projectHasProblem()} class="project-strip" title={projectStatus()}>{projectStatus()}</div>
				<nav class="file-tree" aria-label="Repository files">
					{#if repository.tree.length === 0}<div class="tree-empty">This repository is empty.</div>{:else}
						{#each visibleNodes as node (node.path)}
							<button class:active={node.type === 'file' && activePath === node.path} class="tree-row" style={`--depth: ${node.depth}`} onclick={() => node.type === 'directory' ? toggleDirectory(node.path) : openFile(node)} oncontextmenu={(event) => openFileMenu(event, node)} title={node.path}>
								{#if node.type === 'directory'}<svg class:expanded={expandedPaths.has(node.path)} viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 5 5-5 5" /></svg><span class="folder-icon" aria-hidden="true"></span>{:else}<span class="tree-spacer"></span><span class="file-icon" aria-hidden="true"></span>{/if}
								<span class="tree-name">{node.name}</span>
							</button>
						{/each}
					{/if}
				</nav>
				<footer class="sidebar-footer"><span>WATCHING</span><span>{window.desktop.platform.toUpperCase()}</span></footer>
			</aside>

			<section class="editor-area">
				{#if tabs.length > 0}<div class="tabs" role="tablist" aria-label="Open files">
					{#each tabs as tab (tab.path)}<div class:active={tab.path === activePath} class:attention={tab.conflict !== undefined || !!tab.saveError} class="tab">
						<button class="tab-select" role="tab" aria-selected={tab.path === activePath} onclick={() => activePath = tab.path}><span class:dirty={tab.dirty} class="tab-file-mark"></span><span>{tab.name}</span></button>
						<button class="tab-close" aria-label={`Close ${tab.name}`} onclick={(event) => void closeTab(event, tab.path)}>×</button>
					</div>{/each}
				</div>{/if}

				{#if activeTab}
					<div class="file-bar"><div><span class="breadcrumb">{displayPath(activeTab.path)}</span><span class="breadcrumb-separator">/</span><strong>{activeTab.name}</strong></div><div class="file-bar-actions">{#if isSpecification(activeTab.path)}<button class="highlight-button" onclick={() => regenerateHighlighting(activeTab.path)} disabled={activeTab.highlighting?.status === 'running' || activeTab.conflict !== undefined}>{activeTab.highlighting?.status === 'running' ? 'HIGHLIGHTING…' : 'REGENERATE HIGHLIGHTING'}</button>{/if}{#if activeTab.preview}<span class:problem={activeTab.conflict !== undefined || !!activeTab.saveError || metadataStatus(activeTab)?.includes('STALE') || metadataStatus(activeTab)?.includes('INVALID') || metadataStatus(activeTab)?.includes('MISSING')} class="file-meta">{formatBytes(activeTab.preview.size)} · {tabStatus(activeTab)}{#if metadataStatus(activeTab)} · {metadataStatus(activeTab)}{/if}</span>{/if}</div></div>
					<div class="editor-content">
						{#if activeTab.state === 'loading'}
							<div class="loading-file" aria-live="polite"><span class="loader-line"></span><span class="loader-line short"></span><span class="loader-line medium"></span><p>READING {activeTab.name.toUpperCase()}</p></div>
						{:else if activeTab.state === 'error'}
							<div class="message-state error-state"><span class="state-code">FILE / ERROR</span><h2>Couldn’t keep this file open.</h2><p>{activeTab.error}</p></div>
						{:else if activeTab.preview?.kind === 'text'}
							<div class="text-editor-shell">
								{#if activeTab.conflict !== undefined}
									<div class="conflict-banner" role="alert"><div><strong>FILE CHANGED ON DISK</strong><span>{activeTab.conflict ? 'Choose which version to keep. Huzzah did not overwrite the external edit.' : 'The file was removed outside Huzzah. Your edit remains open and has not been written.'}</span></div>{#if activeTab.conflict?.kind === 'text'}<div class="banner-actions"><button onclick={() => useDiskVersion(activeTab.path)}>USE DISK</button><button class="primary" onclick={() => keepLocalVersion(activeTab.path)}>KEEP MINE</button></div>{/if}</div>
								{:else if activeTab.saveError}
									<div class="conflict-banner save-error" role="alert"><div><strong>SAVE FAILED</strong><span>{activeTab.saveError}</span></div><div class="banner-actions"><button class="primary" onclick={() => retrySave(activeTab.path)}>RETRY</button></div></div>
								{/if}
								{#if activeTab.highlighting?.status === 'error'}<div class="highlight-result error" role="alert"><span>{activeTab.highlighting.error}</span><button onclick={() => regenerateHighlighting(activeTab.path)}>RETRY</button></div>{:else if activeTab.highlighting?.status === 'complete' && activeTab.highlighting.model && activeTab.highlighting.usage}<div class="highlight-result"><span>HIGHLIGHTED WITH {activeTab.highlighting.model.provider} / {activeTab.highlighting.model.id}</span><small>{usageLabel(activeTab.highlighting.usage)}</small></div>{/if}
								<CodeViewer path={activeTab.path} content={activeTab.buffer ?? activeTab.preview.content} highlights={activeTab.metadata?.highlighting.status === 'current' ? activeTab.metadata.highlighting.marks ?? [] : []} onChange={(content) => editFile(activeTab.path, content)} />
							</div>
						{:else if activeTab.preview?.kind === 'unsupported'}
							{#if activeTab.preview.content !== null}<div class="unsupported-header"><span>PLAIN TEXT PREVIEW</span>{activeTab.preview.reason}</div><pre class="plain-preview">{activeTab.preview.content}</pre>
							{:else}<div class="message-state unsupported-state"><span class="binary-glyph" aria-hidden="true">01</span><span class="state-code">UNSUPPORTED / {formatBytes(activeTab.preview.size)}</span><h2>Preview unavailable.</h2><p>{activeTab.preview.reason}</p></div>{/if}
						{/if}
					</div>
				{:else}<div class="welcome-state"></div>{/if}
			</section>
		</div>
	{:else}
		<section class="launch-screen">
			<div class="launch-copy">
				<h1>Welcome to Huzzah</h1>
				<p>Open a local repository to browse and edit supported text files in a focused workspace.</p>
				<button class="launch-action" onclick={chooseRepository} disabled={loadingRepository}><span>{loadingRepository ? 'RESTORING WORKSPACE…' : 'OPEN A REPOSITORY'}</span><strong>↗</strong></button>
				{#if repositoryState.status === 'missing'}<div class="notice"><strong>RECENT REPOSITORY NOT FOUND</strong><span>{repositoryState.path}</span></div>{/if}
				{#if repositoryError}<div class="notice error-notice"><strong>COULDN’T OPEN REPOSITORY</strong><span>{repositoryError}</span></div>{/if}
			</div>
		</section>
	{/if}
</main>

{#if fileMenu}
	<div class="file-context-menu" style={`left: ${Math.min(fileMenu.x, window.innerWidth - 250)}px; top: ${Math.min(fileMenu.y, window.innerHeight - 70)}px`} role="menu">
		<button role="menuitem" disabled={!isSpecification(fileMenu.path)} onclick={() => regenerateFromFileMenu(fileMenu!.path)}>REGENERATE HIGHLIGHTING</button>
	</div>
{/if}

{#if commandPaletteOpen}
	<div class="palette-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) commandPaletteOpen = false; }}>
		<div class="command-palette" role="dialog" aria-modal="true" aria-label="Command palette">
			<header><span>COMMAND PALETTE</span><kbd>{shortcutKey}⇧P</kbd></header>
			<button disabled={!activeTab || !isSpecification(activeTab.path) || activeTab.highlighting?.status === 'running'} onclick={() => activeTab && regenerateHighlighting(activeTab.path)}>
				<strong>Regenerate Highlighting</strong><span>{activeTab && isSpecification(activeTab.path) ? activeTab.path : 'Open a specification to run this command'}</span>
			</button>
		</div>
	</div>
{/if}

{#if newFileOpen}
	<div class="modal-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget && !creatingFile) newFileOpen = false; }}>
		<div class="new-file-dialog" role="dialog" aria-modal="true" aria-labelledby="new-file-title">
			<form onsubmit={submitNewFile}>
				<header><div><span>FILES / CREATE</span><h2 id="new-file-title">New file</h2></div><button type="button" aria-label="Close new file dialog" onclick={() => newFileOpen = false} disabled={creatingFile}>×</button></header>
				<label for="new-file-path">PATH RELATIVE TO REPOSITORY</label>
				<input id="new-file-path" bind:value={newFilePath} spellcheck="false" autocomplete="off" disabled={creatingFile} />
				{#if newFileError}<p class="new-file-error" role="alert">{newFileError}</p>{:else}<p>Missing parent directories will be created automatically.</p>{/if}
				<footer><button type="button" onclick={() => newFileOpen = false} disabled={creatingFile}>CANCEL</button><button class="primary" type="submit" disabled={creatingFile || !newFilePath.trim()}>{creatingFile ? 'CREATING…' : 'CREATE FILE'}</button></footer>
			</form>
		</div>
	</div>
{/if}

{#if syncSummary}
	<div class="modal-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) syncSummary = null; }}>
		<div class="sync-summary" role="dialog" aria-modal="true" aria-labelledby="sync-summary-title">
			<header><div><span>SYNC / PREVIEW</span><h2 id="sync-summary-title">Changed specifications</h2></div><button aria-label="Close sync summary" onclick={() => syncSummary = null}>×</button></header>
			<p>These specification changes are ready for synchronization. Reconciliation will be connected in a later milestone.</p>
			<div class="sync-change-list">
				{#each syncSummary.changes as change}
					<div class="sync-change"><span class={`change-kind ${change.kind}`}>{changeLabel(change)}</span><div>{#if change.kind === 'renamed'}<small>{change.oldPath}</small><span>→</span>{/if}<strong>{change.path}</strong></div></div>
				{/each}
			</div>
			<footer><span>HEAD {syncSummary.head.slice(0, 10)}</span><button onclick={() => syncSummary = null}>DONE</button></footer>
		</div>
	</div>
{/if}
