<script lang="ts">
	import { onDestroy } from 'svelte';
	import type {
		ProposalFileOperation,
		ReviewFixtureName,
		ReviewProposal
	} from '../../shared/desktop';

	type ReviewTreeNode =
		| { type: 'directory'; name: string; path: string; children: ReviewTreeNode[] }
		| { type: 'file'; name: string; path: string; file: ProposalFileOperation };
	type VisibleReviewTreeNode = ReviewTreeNode & { depth: number };

	let { proposal, loading = false, onReject, onFixtureChange }: {
		proposal: ReviewProposal;
		loading?: boolean;
		onReject: () => void;
		onFixtureChange: (fixture: ReviewFixtureName) => void;
	} = $props();

	let selectedId = $state('');
	let width = $state(650);
	let commitMessage = $state('');
	let commitDescription = $state('');
	let dragging = $state(false);
	let initializedProposalId = $state('');
	let expandedReviewPaths = $state(new Set<string>());

	let readyProposal = $derived(proposal.status === 'ready' ? proposal : null);
	let selected = $derived(readyProposal?.operations.find((file) => file.id === selectedId) ?? readyProposal?.operations[0] ?? null);
	let sourceFiles = $derived(readyProposal?.operations.filter((file) => !file.generatedMetadata) ?? []);
	let additions = $derived(readyProposal?.operations.reduce((sum, file) => sum + file.additions, 0) ?? 0);
	let deletions = $derived(readyProposal?.operations.reduce((sum, file) => sum + file.deletions, 0) ?? 0);
	let reviewTree = $derived(buildReviewTree(readyProposal?.operations ?? []));
	let visibleReviewTree = $derived(flattenReviewTree(reviewTree, expandedReviewPaths));

	$effect(() => {
		if (!readyProposal || readyProposal.id === initializedProposalId) return;
		initializedProposalId = readyProposal.id;
		selectedId = sourceFiles[0]?.id ?? readyProposal.operations[0]?.id ?? '';
		commitMessage = readyProposal.commitMessage;
		commitDescription = readyProposal.summary;
		expandedReviewPaths = new Set(
			collectReviewDirectories(buildReviewTree(readyProposal.operations))
				.filter((path) => path !== '.huzzah' && !path.startsWith('.huzzah/'))
		);
	});

	function commonDirectory(files: ProposalFileOperation[]): string[] {
		if (files.length === 0) return [];
		const directories = files.map((file) => file.path.split('/').slice(0, -1));
		return directories[0].filter((segment, index) => directories.every((directory) => directory[index] === segment));
	}

	function buildReviewTree(files: ProposalFileOperation[]): ReviewTreeNode[] {
		const root: Extract<ReviewTreeNode, { type: 'directory' }> = { type: 'directory', name: '', path: '', children: [] };
		for (const file of files) {
			const segments = file.path.split('/');
			let directory = root;
			for (let index = 0; index < segments.length - 1; index += 1) {
				const path = segments.slice(0, index + 1).join('/');
				let child = directory.children.find((node): node is Extract<ReviewTreeNode, { type: 'directory' }> => node.type === 'directory' && node.path === path);
				if (!child) {
					child = { type: 'directory', name: segments[index], path, children: [] };
					directory.children.push(child);
				}
				directory = child;
			}
			directory.children.push({ type: 'file', name: segments.at(-1) ?? file.path, path: file.path, file });
		}
		const sort = (nodes: ReviewTreeNode[]): void => {
			nodes.sort((left, right) => left.type === right.type ? left.name.localeCompare(right.name) : left.type === 'directory' ? -1 : 1);
			for (const node of nodes) if (node.type === 'directory') sort(node.children);
		};
		sort(root.children);
		const commonPath = commonDirectory(files).join('/');
		if (!commonPath) return root.children;
		let current: ReviewTreeNode | undefined;
		let children = root.children;
		for (const segment of commonPath.split('/')) {
			current = children.find((node) => node.type === 'directory' && node.name === segment);
			if (!current || current.type !== 'directory') return root.children;
			children = current.children;
		}
		return current ? [current] : root.children;
	}

	function collectReviewDirectories(nodes: ReviewTreeNode[]): string[] {
		return nodes.flatMap((node) => node.type === 'directory' ? [node.path, ...collectReviewDirectories(node.children)] : []);
	}

	function flattenReviewTree(nodes: ReviewTreeNode[], expanded: Set<string>, depth = 0): VisibleReviewTreeNode[] {
		return nodes.flatMap((node) => [
			{ ...node, depth } as VisibleReviewTreeNode,
			...(node.type === 'directory' && expanded.has(node.path) ? flattenReviewTree(node.children, expanded, depth + 1) : [])
		]);
	}

	function toggleReviewDirectory(path: string): void {
		const next = new Set(expandedReviewPaths);
		if (next.has(path)) next.delete(path);
		else next.add(path);
		expandedReviewPaths = next;
	}

	function beginResize(event: PointerEvent): void {
		event.preventDefault();
		dragging = true;
		document.body.classList.add('review-resizing');
		window.addEventListener('pointermove', resize);
		window.addEventListener('pointerup', finishResize, { once: true });
	}

	function resize(event: PointerEvent): void {
		width = Math.max(390, Math.min(820, window.innerWidth - event.clientX));
	}

	function finishResize(): void {
		dragging = false;
		document.body.classList.remove('review-resizing');
		window.removeEventListener('pointermove', resize);
	}

	function navigateDiff(event: KeyboardEvent & { currentTarget: HTMLDivElement }): void {
		if (event.key === 'Home') event.currentTarget.scrollTo({ top: 0 });
		if (event.key === 'End') event.currentTarget.scrollTo({ top: event.currentTarget.scrollHeight });
	}

	onDestroy(() => {
		finishResize();
	});
</script>

<aside class:dragging class="review-panel" style={`width: ${width}px`} aria-label="Reconciliation proposal review">
	<button class="review-resize" aria-label="Resize review panel" title="Drag to resize" onpointerdown={beginResize}><span></span></button>

	{#if loading}
		<div class="review-loading" aria-live="polite"><span></span><strong>PREPARING FIXTURE</strong><small>Assembling a deterministic proposal…</small></div>
	{:else if proposal.status === 'error'}
		<div class="review-error" role="alert">
			<span class="error-code">PROPOSAL / INVALID</span>
			<div class="error-glyph">!</div>
			<h3>{proposal.title}</h3>
			<p>{proposal.message}</p>
			<small>HEAD {proposal.capturedHead.slice(0, 10)} · LIVE REPOSITORY UNCHANGED</small>
			{#if proposal.retryable}<button onclick={() => onFixtureChange('comprehensive')}>LOAD VALID FIXTURE</button>{/if}
		</div>
	{:else}
		<header class="review-panel-title">
			<span>{proposal.operations.length} FILES CHANGED</span>
			<div class="review-title-metrics"><i>+{additions}</i><b>−{deletions}</b><span>{proposal.usage.tokens.total.toLocaleString()} TOKENS</span><span>${proposal.usage.estimatedCostUsd.toFixed(4)}</span></div>
		</header>

		<div class="review-files-and-diff">
			<nav class="affected-files" aria-label="Affected files">
				<div class="file-operation-list">
					{#each visibleReviewTree as node (node.path)}
						<button
							class:directory={node.type === 'directory'}
							class:active={node.type === 'file' && selected?.id === node.file.id}
							class="review-tree-row"
							style={`--tree-depth: ${node.depth}`}
							onclick={() => node.type === 'directory' ? toggleReviewDirectory(node.path) : selectedId = node.file.id}
						>
							{#if node.type === 'directory'}<span class:expanded={expandedReviewPaths.has(node.path)} class="review-tree-chevron">›</span><span class="folder-icon" aria-hidden="true"></span>{:else}<span class="review-tree-indent"></span><span class="file-icon" aria-hidden="true"></span>{/if}
							<strong>{node.name}</strong>
						</button>
					{/each}
				</div>
			</nav>

			<section class="proposal-diff" aria-label="Selected file diff">
				{#if selected}
					<header>
						<div><strong>{selected.path}</strong>{#if selected.oldPath}<small>FROM {selected.oldPath}</small>{/if}</div>
						<span class="diff-totals"><i>+{selected.additions}</i><b>−{selected.deletions}</b></span>
					</header>
					{#if selected.binary}
						<div class="binary-diff"><span>01</span><strong>Binary file</strong><p>A complete text diff is unavailable. The path and operation are included in the reviewed proposal.</p></div>
					{:else}
						<div class="diff-lines" role="textbox" aria-readonly="true" aria-multiline="true" tabindex="0" aria-label={`Complete diff for ${selected.path}`} onkeydown={navigateDiff}>
							{#each selected.diff as line}
								{#if line.kind !== 'header'}<div class={`diff-line ${line.kind}`}><span>{line.oldLine ?? ''}</span><span>{line.newLine ?? ''}</span><code>{line.text}</code></div>{/if}
							{/each}
						</div>
					{/if}
				{/if}
			</section>
		</div>

		<div class="review-notes">
			<details open><summary>ASSUMPTIONS <span>{proposal.assumptions.length}</span></summary><ul>{#each proposal.assumptions as assumption}<li>{assumption}</li>{/each}</ul></details>
			<details open><summary>WARNINGS <span>{proposal.warnings.length}</span></summary><ul class="warnings">{#each proposal.warnings as warning}<li>{warning}</li>{/each}</ul></details>
		</div>

		<footer class="review-footer">
			<div class="commit-editor">
				<label for="commit-message">COMMIT MESSAGE</label>
				<input id="commit-message" bind:value={commitMessage} spellcheck="false" />
				<textarea id="commit-description" aria-label="Commit description" bind:value={commitDescription} spellcheck="true" rows="3"></textarea>
			</div>
			<div class="commit-actions"><button class="reject" onclick={onReject}>REJECT</button><button class="approve" disabled title="Approval is enabled in Milestone 9">APPROVE &amp; COMMIT</button></div>
			<small>FIXTURE MODE · APPROVAL REMAINS DISABLED IN MILESTONE 6</small>
		</footer>
	{/if}
</aside>
