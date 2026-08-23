<script lang="ts">
	import { onMount } from 'svelte';
	import type { FilePreview, RepositoryState, RepositoryTreeNode } from '../../shared/desktop';
	import CodeViewer from './CodeViewer.svelte';

	type OpenTab = { path: string; name: string; state: 'loading' | 'ready' | 'error'; preview?: FilePreview; error?: string };
	type VisibleNode = RepositoryTreeNode & { depth: number };

	let repositoryState = $state<RepositoryState>({ status: 'empty' });
	let loadingRepository = $state(true);
	let repositoryError = $state('');
	let tabs = $state<OpenTab[]>([]);
	let activePath = $state<string | null>(null);
	let expandedPaths = $state(new Set<string>());

	let repository = $derived(repositoryState.status === 'ready' ? repositoryState.repository : null);
	let activeTab = $derived(tabs.find((tab) => tab.path === activePath) ?? null);
	let visibleNodes = $derived(flattenTree(repository?.tree ?? [], expandedPaths));
	let shortcutKey = $derived(window.desktop.platform === 'darwin' ? '⌘' : 'Ctrl');

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
			tabs = [];
			activePath = null;
			expandedPaths = new Set(nextState.repository.tree.filter((node) => node.type === 'directory').slice(0, 2).map((node) => node.path));
		}
	}

	async function chooseRepository(): Promise<void> {
		if (loadingRepository) return;
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
		try {
			await window.desktop.closeRepository();
			repositoryState = { status: 'empty' };
			tabs = [];
			activePath = null;
			expandedPaths = new Set();
			repositoryError = '';
		} catch (error) {
			repositoryError = errorMessage(error);
		}
	}

	function toggleDirectory(path: string): void {
		const next = new Set(expandedPaths);
		if (next.has(path)) next.delete(path);
		else next.add(path);
		expandedPaths = next;
	}

	async function openFile(node: RepositoryTreeNode): Promise<void> {
		if (node.type !== 'file') return;
		if (tabs.some((tab) => tab.path === node.path)) { activePath = node.path; return; }
		tabs = [...tabs, { path: node.path, name: node.name, state: 'loading' }];
		activePath = node.path;
		try {
			const preview = await window.desktop.readFile(node.path);
			tabs = tabs.map((tab) => tab.path === node.path ? { ...tab, state: 'ready', preview } : tab);
		} catch (error) {
			tabs = tabs.map((tab) => tab.path === node.path ? { ...tab, state: 'error', error: errorMessage(error) } : tab);
		}
	}

	function closeTab(event: MouseEvent, path: string): void {
		event.stopPropagation();
		const index = tabs.findIndex((tab) => tab.path === path);
		const wasActive = activePath === path;
		tabs = tabs.filter((tab) => tab.path !== path);
		if (wasActive) activePath = tabs[Math.min(index, tabs.length - 1)]?.path ?? null;
	}

	function formatBytes(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	function displayPath(path: string): string { return path.split('/').slice(0, -1).join('/') || 'repository root'; }

	onMount(() => {
		const handleKeydown = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'o') { event.preventDefault(); void chooseRepository(); }
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'w' && activePath) { event.preventDefault(); closeTab(new MouseEvent('click'), activePath); }
		};
		window.addEventListener('keydown', handleKeydown);
		void window.desktop.getRepositoryState().then(applyRepositoryState).catch((error) => {
			repositoryError = errorMessage(error);
			repositoryState = { status: 'empty' };
		}).finally(() => { loadingRepository = false; });
		return () => window.removeEventListener('keydown', handleKeydown);
	});
</script>

<svelte:head><title>{repository ? `${repository.name} — Huzzah` : 'Huzzah'}</title></svelte:head>

<main class="app-shell">
	<header class="titlebar">
		<div class="wordmark" aria-label="Huzzah"><span class="wordmark-mark">H</span><span class="wordmark-name">HUZZAH</span><span class="phase-label">REPOSITORY READER</span></div>
		<div class="repository-identity">
			{#if repository}<span class="status-dot" aria-hidden="true"></span><div><strong>{repository.name}</strong><span>{repository.path}</span></div>{:else}<span>NO REPOSITORY OPEN</span>{/if}
		</div>
		<div class="repository-actions">
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
				<nav class="file-tree" aria-label="Repository files">
					{#if repository.tree.length === 0}<div class="tree-empty">This repository is empty.</div>{:else}
						{#each visibleNodes as node (node.path)}
							<button class:active={node.type === 'file' && activePath === node.path} class="tree-row" style={`--depth: ${node.depth}`} onclick={() => node.type === 'directory' ? toggleDirectory(node.path) : openFile(node)} title={node.path}>
								{#if node.type === 'directory'}<svg class:expanded={expandedPaths.has(node.path)} viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 5 5-5 5" /></svg><span class="folder-icon" aria-hidden="true"></span>{:else}<span class="tree-spacer"></span><span class="file-icon" aria-hidden="true"></span>{/if}
								<span class="tree-name">{node.name}</span>
							</button>
						{/each}
					{/if}
				</nav>
				<footer class="sidebar-footer"><span>READ ONLY</span><span>{window.desktop.platform.toUpperCase()}</span></footer>
			</aside>

			<section class="editor-area">
				{#if tabs.length > 0}<div class="tabs" role="tablist" aria-label="Open files">
					{#each tabs as tab (tab.path)}<div class:active={tab.path === activePath} class="tab">
						<button class="tab-select" role="tab" aria-selected={tab.path === activePath} onclick={() => activePath = tab.path}><span class="tab-file-mark"></span><span>{tab.name}</span></button>
						<button class="tab-close" aria-label={`Close ${tab.name}`} onclick={(event) => closeTab(event, tab.path)}>×</button>
					</div>{/each}
				</div>{/if}

				{#if activeTab}
					<div class="file-bar"><div><span class="breadcrumb">{displayPath(activeTab.path)}</span><span class="breadcrumb-separator">/</span><strong>{activeTab.name}</strong></div>{#if activeTab.preview}<span class="file-meta">{formatBytes(activeTab.preview.size)} · READ ONLY</span>{/if}</div>
					<div class="editor-content">
						{#if activeTab.state === 'loading'}
							<div class="loading-file" aria-live="polite"><span class="loader-line"></span><span class="loader-line short"></span><span class="loader-line medium"></span><p>READING {activeTab.name.toUpperCase()}</p></div>
						{:else if activeTab.state === 'error'}
							<div class="message-state error-state"><span class="state-code">FILE / ERROR</span><h2>Couldn’t read this file.</h2><p>{activeTab.error}</p></div>
						{:else if activeTab.preview?.kind === 'text'}
							{#key activeTab.path}<CodeViewer content={activeTab.preview.content} />{/key}
						{:else if activeTab.preview?.kind === 'unsupported'}
							{#if activeTab.preview.content !== null}<div class="unsupported-header"><span>PLAIN TEXT PREVIEW</span>{activeTab.preview.reason}</div><pre class="plain-preview">{activeTab.preview.content}</pre>
							{:else}<div class="message-state unsupported-state"><span class="binary-glyph" aria-hidden="true">01</span><span class="state-code">UNSUPPORTED / {formatBytes(activeTab.preview.size)}</span><h2>Preview unavailable.</h2><p>{activeTab.preview.reason}</p></div>{/if}
						{/if}
					</div>
				{:else}
					<div class="welcome-state">

					</div>
				{/if}
			</section>
		</div>
	{:else}
		<section class="launch-screen">
			<div class="launch-copy">
				<h1>Welcome to Huzzah</h1>
				<p>Open a local repository to browse its structure and inspect files in a focused, read-only workspace.</p>
				<button class="launch-action" onclick={chooseRepository} disabled={loadingRepository}><span>{loadingRepository ? 'RESTORING WORKSPACE…' : 'OPEN A REPOSITORY'}</span><strong>↗</strong></button>
				{#if repositoryState.status === 'missing'}<div class="notice"><strong>RECENT REPOSITORY NOT FOUND</strong><span>{repositoryState.path}</span></div>{/if}
				{#if repositoryError}<div class="notice error-notice"><strong>COULDN’T OPEN REPOSITORY</strong><span>{repositoryError}</span></div>{/if}
			</div>
		</section>
	{/if}
</main>
