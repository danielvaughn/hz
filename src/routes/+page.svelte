<script lang="ts">
	import IntentEditor from '$lib/components/IntentEditor.svelte';
	import Repl from '$lib/components/Repl.svelte';
	import SourceViewer from '$lib/components/SourceViewer.svelte';
	import { presentableDiff } from '@codemirror/merge';
	import { onMount } from 'svelte';

	const MIN_SPLIT = 20;
	const MAX_SPLIT = 80;
	const KEYBOARD_STEP = 2;
	const STORAGE_KEY = 'project:default';
	const SAVE_DELAY = 120;

	type OutputTab = 'source' | 'repl';
	type PersistenceState = 'loading' | 'saved' | 'saving' | 'error';
	type ReconciliationState = 'idle' | 'generating' | 'reviewing' | 'error';

	type StoredIntentV1 = {
		version: 1;
		draftIntent: string;
		committedIntent: string;
	};

	type CommitRecord = {
		id: string;
		createdAt: string;
		intent: string;
		source: string;
	};

	type StoredProjectV2 = {
		version: 2;
		draftIntent: string;
		committedIntent: string;
		committedSource: string;
		proposedSource: string | null;
		proposalIntent: string | null;
		proposalSummary: string;
		proposalAssumptions: string[];
		selectedOutputTab: OutputTab;
	};

	type StoredProject = Omit<StoredProjectV2, 'version'> & {
		version: 3;
		commits: CommitRecord[];
	};

	type ReconcileResponse = {
		proposedSource: string;
		summary: string;
		assumptions: string[];
	};

	let workspace: HTMLElement;
	let split = $state(50);
	let resizing = $state(false);
	let stacked = $state(false);
	let draftIntent = $state('');
	let committedIntent = $state('');
	let committedSource = $state('');
	let proposedSource = $state<string | null>(null);
	let proposalIntent = $state<string | null>(null);
	let proposalSummary = $state('');
	let proposalAssumptions = $state<string[]>([]);
	let commits = $state<CommitRecord[]>([]);
	let selectedOutputTab = $state<OutputTab>('source');
	let persistenceState = $state<PersistenceState>('loading');
	let reconciliationState = $state<ReconciliationState>('idle');
	let reconciliationError = $state('');
	let storage: LocalForage | undefined;
	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	let saveRevision = 0;
	let hydrated = false;
	let editedBeforeHydration = false;

	let dirty = $derived(draftIntent !== committedIntent);
	let commitDisabled = $derived(
		!dirty || reconciliationState === 'generating' || reconciliationState === 'reviewing'
	);
	let statusLabel = $derived.by(() => {
		if (reconciliationState === 'generating') return 'Reconciling intent';
		if (persistenceState === 'loading') return 'Loading draft';
		if (persistenceState === 'error') return 'Storage unavailable';
		return dirty ? 'Uncommitted changes' : 'Synchronized';
	});
	let displayedSource = $derived(proposedSource ?? committedSource);
	let sourceViewKey = $derived(`${proposedSource === null ? 'committed' : 'proposal'}:${displayedSource}`);

	function clamp(value: number) {
		return Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, value));
	}

	function setSplitFromPointer(event: PointerEvent) {
		const bounds = workspace.getBoundingClientRect();
		const position = stacked ? event.clientY - bounds.top : event.clientX - bounds.left;
		const dimension = stacked ? bounds.height : bounds.width;

		split = clamp((position / dimension) * 100);
	}

	function handlePointerDown(event: PointerEvent) {
		resizing = true;
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		setSplitFromPointer(event);
	}

	function handlePointerMove(event: PointerEvent) {
		if (resizing) setSplitFromPointer(event);
	}

	function handlePointerUp(event: PointerEvent) {
		resizing = false;

		const divider = event.currentTarget as HTMLElement;
		if (divider.hasPointerCapture(event.pointerId)) divider.releasePointerCapture(event.pointerId);
	}

	function handleDividerKeydown(event: KeyboardEvent) {
		let nextSplit = split;

		switch (event.key) {
			case 'ArrowLeft':
				if (!stacked) nextSplit -= KEYBOARD_STEP;
				break;
			case 'ArrowRight':
				if (!stacked) nextSplit += KEYBOARD_STEP;
				break;
			case 'ArrowUp':
				if (stacked) nextSplit -= KEYBOARD_STEP;
				break;
			case 'ArrowDown':
				if (stacked) nextSplit += KEYBOARD_STEP;
				break;
			case 'Home':
				nextSplit = MIN_SPLIT;
				break;
			case 'End':
				nextSplit = MAX_SPLIT;
				break;
			default:
				return;
		}

		event.preventDefault();
		split = clamp(nextSplit);
	}

	function getProjectSnapshot(): StoredProject {
		return {
			version: 3,
			draftIntent,
			committedIntent,
			committedSource,
			proposedSource,
			proposalIntent,
			proposalSummary,
			proposalAssumptions: [...proposalAssumptions],
			commits: commits.map((commit) => ({ ...commit })),
			selectedOutputTab
		};
	}

	function schedulePersistence() {
		if (!hydrated || !storage) return;

		persistenceState = 'saving';
		const revision = ++saveRevision;
		const snapshot = getProjectSnapshot();

		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(async () => {
			try {
				await storage?.setItem(STORAGE_KEY, snapshot);
				if (revision === saveRevision) persistenceState = 'saved';
			} catch {
				if (revision === saveRevision) persistenceState = 'error';
			}
		}, SAVE_DELAY);
	}

	function handleIntentChange(value: string) {
		draftIntent = value;

		if (!hydrated) {
			editedBeforeHydration = true;
			return;
		}

		schedulePersistence();
	}

	function selectOutputTab(tab: OutputTab) {
		if (selectedOutputTab === tab) return;
		selectedOutputTab = tab;
		schedulePersistence();
	}

	function formatIntentDiff(previous: string, next: string) {
		return JSON.stringify(
			presentableDiff(previous, next, { timeout: 150 }).map((change) => ({
				removed: previous.slice(change.fromA, change.toA),
				added: next.slice(change.fromB, change.toB)
			})),
			null,
			2
		);
	}

	async function handleCommit() {
		if (commitDisabled) return;

		const nextIntent = draftIntent;
		reconciliationState = 'generating';
		reconciliationError = '';
		selectedOutputTab = 'source';
		schedulePersistence();

		try {
			const response = await fetch('/api/reconcile', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					previousIntent: committedIntent,
					nextIntent,
					intentDiff: formatIntentDiff(committedIntent, nextIntent),
					currentSource: committedSource
				})
			});

			const result = (await response.json()) as ReconcileResponse | { error?: string };
			if (!response.ok || !('proposedSource' in result)) {
				throw new Error('error' in result && result.error ? result.error : 'Reconciliation failed.');
			}

			proposedSource = result.proposedSource;
			proposalIntent = nextIntent;
			proposalSummary = result.summary;
			proposalAssumptions = result.assumptions;
			reconciliationState = 'reviewing';
			schedulePersistence();
		} catch (error) {
			reconciliationError = error instanceof Error ? error.message : 'Reconciliation failed.';
			reconciliationState = 'error';
		}
	}

	function clearProposal() {
		proposedSource = null;
		proposalIntent = null;
		proposalSummary = '';
		proposalAssumptions = [];
	}

	function acceptProposal() {
		if (proposedSource === null || proposalIntent === null) return;

		committedIntent = proposalIntent;
		committedSource = proposedSource;
		commits = [
			...commits,
			{
				id: crypto.randomUUID(),
				createdAt: new Date().toISOString(),
				intent: proposalIntent,
				source: proposedSource
			}
		];
		clearProposal();
		reconciliationState = 'idle';
		schedulePersistence();
	}

	function rejectProposal() {
		clearProposal();
		reconciliationState = 'idle';
		schedulePersistence();
	}

	function dismissError() {
		reconciliationError = '';
		reconciliationState = 'idle';
	}

	onMount(() => {
		const mediaQuery = window.matchMedia('(max-width: 48rem)');
		const updateOrientation = () => (stacked = mediaQuery.matches);

		updateOrientation();
		mediaQuery.addEventListener('change', updateOrientation);

		void (async () => {
			try {
				const { default: localforage } = await import('localforage');
				storage = localforage.createInstance({ name: 'hz', storeName: 'projects' });

				const stored = await storage.getItem<StoredProject | StoredProjectV2 | StoredIntentV1>(
					STORAGE_KEY
				);
				if (stored?.version === 3) {
					committedIntent = stored.committedIntent;
					committedSource = stored.committedSource;
					commits = stored.commits;
					selectedOutputTab = stored.selectedOutputTab;

					if (!editedBeforeHydration) {
						draftIntent = stored.draftIntent;
						proposedSource = stored.proposedSource;
						proposalIntent = stored.proposalIntent;
						proposalSummary = stored.proposalSummary;
						proposalAssumptions = stored.proposalAssumptions;
						reconciliationState = stored.proposedSource ? 'reviewing' : 'idle';
					}
				} else if (stored?.version === 2) {
					committedIntent = stored.committedIntent;
					committedSource = stored.committedSource;
					selectedOutputTab = stored.selectedOutputTab;

					if (!editedBeforeHydration) {
						draftIntent = stored.draftIntent;
						proposedSource = stored.proposedSource;
						proposalIntent = stored.proposalIntent;
						proposalSummary = stored.proposalSummary;
						proposalAssumptions = stored.proposalAssumptions;
						reconciliationState = stored.proposedSource ? 'reviewing' : 'idle';
					}
				} else if (stored?.version === 1) {
					committedIntent = stored.committedIntent;
					if (!editedBeforeHydration) draftIntent = stored.draftIntent;
				}

				hydrated = true;
				if (editedBeforeHydration) schedulePersistence();
				else persistenceState = 'saved';
			} catch {
				hydrated = true;
				persistenceState = 'error';
			}
		})();

		return () => {
			mediaQuery.removeEventListener('change', updateOrientation);
			if (saveTimer) clearTimeout(saveTimer);
		};
	});
</script>

<svelte:head>
	<title>hz</title>
</svelte:head>

<main
	bind:this={workspace}
	class:workspace--resizing={resizing}
	class="workspace"
	style={`--split: ${split}%`}
	aria-label="hz workspace"
>
	<section class="workspace__pane workspace__pane--intent" aria-label="Intent workspace">
		<div class="workspace__editor">
			<IntentEditor value={draftIntent} onchange={handleIntentChange} />
		</div>

		<footer class="intent-status" aria-live="polite">
			<div class="intent-status__state" data-state={dirty ? 'dirty' : 'clean'}>
				<span class="intent-status__dot" aria-hidden="true"></span>
				<span>{statusLabel}</span>
			</div>

			<button
				class="intent-status__commit"
				class:intent-status__commit--ready={!commitDisabled}
				type="button"
				disabled={commitDisabled}
				onclick={handleCommit}
			>
				{reconciliationState === 'generating' ? 'Reconciling…' : 'Commit'}
			</button>
		</footer>
	</section>

	<button
		class="workspace__divider"
		type="button"
		role="slider"
		aria-label="Resize workspace panes"
		aria-orientation={stacked ? 'horizontal' : 'vertical'}
		aria-valuemin={MIN_SPLIT}
		aria-valuemax={MAX_SPLIT}
		aria-valuenow={Math.round(split)}
		onpointerdown={handlePointerDown}
		onpointermove={handlePointerMove}
		onpointerup={handlePointerUp}
		onpointercancel={handlePointerUp}
		onkeydown={handleDividerKeydown}
	></button>

	<section class="workspace__pane workspace__pane--output" aria-label="Output workspace">
		<header class="output-tabs" role="tablist" aria-label="Output views">
			<button
				class:output-tabs__tab--active={selectedOutputTab === 'source'}
				class="output-tabs__tab"
				type="button"
				role="tab"
				aria-selected={selectedOutputTab === 'source'}
				aria-controls="source-panel"
				onclick={() => selectOutputTab('source')}
			>
				Source
			</button>
			<button
				class:output-tabs__tab--active={selectedOutputTab === 'repl'}
				class="output-tabs__tab"
				type="button"
				role="tab"
				aria-selected={selectedOutputTab === 'repl'}
				aria-controls="repl-panel"
				onclick={() => selectOutputTab('repl')}
			>
				REPL
			</button>
			{#if proposedSource !== null}
				<span class="output-tabs__badge">Review</span>
			{/if}
		</header>

		<div
			id="source-panel"
			class="output-content"
			role="tabpanel"
			aria-label="Generated source"
			hidden={selectedOutputTab !== 'source'}
		>
				{#if reconciliationState === 'generating'}
					<div class="output-empty output-empty--working">
						<span class="output-empty__pulse" aria-hidden="true"></span>
						<span>Reconciling implementation</span>
					</div>
				{:else if displayedSource}
					{#key sourceViewKey}
						<SourceViewer source={displayedSource} original={proposedSource === null ? null : committedSource} />
					{/key}
				{:else}
					<div class="output-empty">
						<span>No generated source yet</span>
						<small>Commit an intent to create the first implementation.</small>
					</div>
				{/if}
		</div>

		<div
			id="repl-panel"
			class="output-content"
			role="tabpanel"
			aria-label="JavaScript REPL"
			hidden={selectedOutputTab !== 'repl'}
		>
			<Repl source={committedSource} />
		</div>

		{#if reconciliationState === 'reviewing' && proposedSource !== null}
			<aside class="proposal-review" aria-label="Proposed implementation review">
				<div class="proposal-review__copy">
					<p>{proposalSummary}</p>
					{#if proposalAssumptions.length > 0}
						<div class="proposal-review__assumptions">
							<span>Assumptions</span>
							<ul>
								{#each proposalAssumptions as assumption}
									<li>{assumption}</li>
								{/each}
							</ul>
						</div>
					{/if}
				</div>
				<div class="proposal-review__actions">
					<button class="review-button review-button--secondary" type="button" onclick={rejectProposal}>
						Reject
					</button>
					<button class="review-button review-button--primary" type="button" onclick={acceptProposal}>
						Accept
					</button>
				</div>
			</aside>
		{:else if reconciliationState === 'error'}
			<aside class="proposal-error" aria-live="polite">
				<span>{reconciliationError}</span>
				<button type="button" onclick={dismissError}>Dismiss</button>
			</aside>
		{/if}
	</section>
</main>
