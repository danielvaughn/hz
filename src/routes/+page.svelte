<script lang="ts">
	import IntentEditor from '$lib/components/IntentEditor.svelte';
	import Repl from '$lib/components/Repl.svelte';
	import SourceViewer from '$lib/components/SourceViewer.svelte';
	import { presentableDiff } from '@codemirror/merge';
	import { Tooltip } from 'bits-ui';
	import { onMount } from 'svelte';

	const MIN_SPLIT = 20;
	const MAX_SPLIT = 80;
	const KEYBOARD_STEP = 2;
	const STORAGE_KEY = 'project:default';
	const SAVE_DELAY = 120;
	const SYNCHRONIZATION_LIMIT = 92;
	const SYNCHRONIZATION_TIME_CONSTANT = 8_000;
	const SYNCHRONIZATION_FRAME_INTERVAL = 80;
	const SYNCHRONIZATION_FINISH_DURATION = 280;
	const MIN_REVIEW_HEIGHT = 144;
	const MIN_SOURCE_HEIGHT = 112;
	const OUTPUT_HEADER_HEIGHT = 44;
	const REVIEW_KEYBOARD_STEP = 16;

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
	let outputPane: HTMLElement;
	let reviewPanel: HTMLElement;
	let split = $state(50);
	let resizing = $state(false);
	let reviewResizing = $state(false);
	let reviewHeight = $state<number | null>(null);
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
	let synchronizationProgress = $state(0);
	let synchronizationFinishing = $state(false);
	let storage: LocalForage | undefined;
	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	let synchronizationFrame: number | undefined;
	let saveRevision = 0;
	let hydrated = false;
	let editedBeforeHydration = false;
	let reviewResizeStartY = 0;
	let reviewResizeStartHeight = 0;

	let dirty = $derived(draftIntent !== committedIntent);
	let commitDisabled = $derived(
		!dirty || reconciliationState === 'generating' || reconciliationState === 'reviewing'
	);
	let intentChanges = $derived(summarizeIntentDiff(committedIntent, draftIntent));
	let displayedSource = $derived(proposedSource ?? committedSource);
	let sourceViewKey = $derived(`${proposedSource === null ? 'committed' : 'proposal'}:${displayedSource}`);
	let status = $derived.by(() => {
		if (persistenceState === 'error') return { kind: 'error', message: 'Draft storage is unavailable' };
		if (reconciliationState === 'error') return { kind: 'error', message: 'Synchronization failed' };
		if (reconciliationState === 'generating') return { kind: 'working', message: 'Synchronizing implementation' };
		if (reconciliationState === 'reviewing') return { kind: 'review', message: 'Implementation ready for review' };
		if (persistenceState === 'loading') return { kind: 'neutral', message: 'Loading saved project' };
		if (persistenceState === 'saving') return { kind: 'working', message: 'Saving draft' };
		if (dirty) return { kind: 'dirty', message: 'Intent has uncommitted changes' };
		return { kind: 'clean', message: 'Intent and implementation are synchronized' };
	});

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

	function maximumReviewHeight() {
		return Math.max(
			MIN_REVIEW_HEIGHT,
			outputPane.getBoundingClientRect().height - OUTPUT_HEADER_HEIGHT - MIN_SOURCE_HEIGHT
		);
	}

	function setReviewHeight(value: number) {
		reviewHeight = Math.min(maximumReviewHeight(), Math.max(MIN_REVIEW_HEIGHT, value));
	}

	function handleReviewResizeStart(event: PointerEvent) {
		reviewResizing = true;
		reviewResizeStartY = event.clientY;
		reviewResizeStartHeight = reviewPanel.getBoundingClientRect().height;
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		setReviewHeight(reviewResizeStartHeight);
	}

	function handleReviewResizeMove(event: PointerEvent) {
		if (!reviewResizing) return;
		setReviewHeight(reviewResizeStartHeight + reviewResizeStartY - event.clientY);
	}

	function handleReviewResizeEnd(event: PointerEvent) {
		reviewResizing = false;

		const handle = event.currentTarget as HTMLElement;
		if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
	}

	function handleReviewResizeKeydown(event: KeyboardEvent) {
		const currentHeight = reviewHeight ?? reviewPanel.getBoundingClientRect().height;

		switch (event.key) {
			case 'ArrowUp':
				setReviewHeight(currentHeight + REVIEW_KEYBOARD_STEP);
				break;
			case 'ArrowDown':
				setReviewHeight(currentHeight - REVIEW_KEYBOARD_STEP);
				break;
			case 'Home':
				setReviewHeight(MIN_REVIEW_HEIGHT);
				break;
			case 'End':
				setReviewHeight(maximumReviewHeight());
				break;
			default:
				return;
		}

		event.preventDefault();
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

	function countChangedLines(text: string) {
		if (!text) return 0;
		const newlineCount = text.match(/\n/g)?.length ?? 0;
		return newlineCount + (text.endsWith('\n') ? 0 : 1);
	}

	function summarizeIntentDiff(previous: string, next: string) {
		return presentableDiff(previous, next, { timeout: 150 }).reduce(
			(summary, change) => ({
				additions: summary.additions + countChangedLines(next.slice(change.fromB, change.toB)),
				removals: summary.removals + countChangedLines(previous.slice(change.fromA, change.toA))
			}),
			{ additions: 0, removals: 0 }
		);
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

	function prefersReducedMotion() {
		return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	}

	function stopSynchronizationProgress() {
		if (synchronizationFrame !== undefined) cancelAnimationFrame(synchronizationFrame);
		synchronizationFrame = undefined;
	}

	function startSynchronizationProgress() {
		stopSynchronizationProgress();
		synchronizationFinishing = false;
		synchronizationProgress = prefersReducedMotion() ? 68 : 6;

		if (prefersReducedMotion()) return;

		const startedAt = performance.now();
		let lastUpdate = startedAt;

		const advance = (now: number) => {
			if (now - lastUpdate >= SYNCHRONIZATION_FRAME_INTERVAL) {
				const elapsed = now - startedAt;
				const range = SYNCHRONIZATION_LIMIT - 6;
				synchronizationProgress = Math.min(
					SYNCHRONIZATION_LIMIT,
					6 + range * (1 - Math.exp(-elapsed / SYNCHRONIZATION_TIME_CONSTANT))
				);
				lastUpdate = now;
			}

			synchronizationFrame = requestAnimationFrame(advance);
		};

		synchronizationFrame = requestAnimationFrame(advance);
	}

	async function finishSynchronizationProgress() {
		stopSynchronizationProgress();
		synchronizationFinishing = true;
		synchronizationProgress = 100;

		await new Promise((resolve) =>
			setTimeout(resolve, prefersReducedMotion() ? 40 : SYNCHRONIZATION_FINISH_DURATION)
		);

		synchronizationFinishing = false;
	}

	async function handleCommit() {
		if (commitDisabled) return;

		const nextIntent = draftIntent;
		reconciliationState = 'generating';
		reconciliationError = '';
		selectedOutputTab = 'source';
		startSynchronizationProgress();
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

			await finishSynchronizationProgress();
			proposedSource = result.proposedSource;
			proposalIntent = nextIntent;
			proposalSummary = result.summary;
			proposalAssumptions = result.assumptions;
			reconciliationState = 'reviewing';
			schedulePersistence();
		} catch (error) {
			stopSynchronizationProgress();
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

	function handleSaveShortcut(event: KeyboardEvent) {
		if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return;

		event.preventDefault();
		if (!commitDisabled) void handleCommit();
	}

	onMount(() => {
		const mediaQuery = window.matchMedia('(max-width: 48rem)');
		const updateOrientation = () => (stacked = mediaQuery.matches);

		updateOrientation();
		mediaQuery.addEventListener('change', updateOrientation);
		window.addEventListener('keydown', handleSaveShortcut);

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
			window.removeEventListener('keydown', handleSaveShortcut);
			if (saveTimer) clearTimeout(saveTimer);
			stopSynchronizationProgress();
		};
	});
</script>

<svelte:head>
	<title>hz</title>
</svelte:head>

<main
	bind:this={workspace}
	class:workspace--resizing={resizing}
	class:workspace--review-resizing={reviewResizing}
	class="workspace"
	style={`--split: ${split}%`}
	aria-label="hz workspace"
>
	<section class="workspace__pane workspace__pane--intent" aria-label="Intent workspace">
		<div class="workspace__editor">
			<IntentEditor value={draftIntent} onchange={handleIntentChange} />
		</div>

		<footer class="intent-status">
			<div class="intent-status__summary">
				<Tooltip.Provider delayDuration={250}>
					<Tooltip.Root>
						<Tooltip.Trigger
							class="intent-status__indicator"
							data-status={status.kind}
							aria-label={status.message}
						></Tooltip.Trigger>
						<Tooltip.Portal to="body">
							<Tooltip.Content class="status-tooltip" side="top" sideOffset={-10.5}>
								{status.message}
								<Tooltip.Arrow class="status-tooltip__arrow" />
							</Tooltip.Content>
						</Tooltip.Portal>
					</Tooltip.Root>
				</Tooltip.Provider>
				<div class="intent-status__diff" aria-label={`${intentChanges.additions} additions, ${intentChanges.removals} removals`}>
					<span class="intent-status__additions">+{intentChanges.additions}</span>
					<span class="intent-status__removals">−{intentChanges.removals}</span>
				</div>
			</div>
			<span class="intent-status__shortcut"><kbd>⌘S</kbd> to save</span>
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

	<section bind:this={outputPane} class="workspace__pane workspace__pane--output" aria-label="Output workspace">
		<header class="output-tabs" role="tablist" aria-label="Output views">
			<button
				class:output-tabs__tab--active={selectedOutputTab === 'source'}
				class:output-tabs__tab--review={proposedSource !== null}
				class="output-tabs__tab"
				type="button"
				role="tab"
				aria-label={proposedSource !== null ? 'Source, changes to review' : 'Source'}
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
		</header>

		<div
			id="source-panel"
			class="output-content"
			role="tabpanel"
			aria-label="Generated source"
			hidden={selectedOutputTab !== 'source'}
		>
				{#if reconciliationState === 'generating'}
					<div class="synchronization" role="status" aria-live="polite" aria-busy="true">
						<div
							class="synchronization__track"
							role="progressbar"
							aria-label="Synchronization in progress"
						>
							<span
								class:synchronization__fill--finishing={synchronizationFinishing}
								class="synchronization__fill"
								style={`width: ${synchronizationProgress}%`}
							></span>
						</div>
						<span class="synchronization__label">SYNCHRONIZING</span>
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
			<aside
				bind:this={reviewPanel}
				class:proposal-review--sized={reviewHeight !== null}
				class="proposal-review"
				style:height={reviewHeight === null ? undefined : `${reviewHeight}px`}
				aria-label="Proposed implementation review"
			>
				<button
					class="proposal-review__resize"
					type="button"
					role="separator"
					aria-label="Resize review details"
					aria-orientation="horizontal"
					aria-valuemin={MIN_REVIEW_HEIGHT}
					aria-valuemax={outputPane ? Math.round(maximumReviewHeight()) : undefined}
					aria-valuenow={reviewHeight === null ? undefined : Math.round(reviewHeight)}
					onpointerdown={handleReviewResizeStart}
					onpointermove={handleReviewResizeMove}
					onpointerup={handleReviewResizeEnd}
					onpointercancel={handleReviewResizeEnd}
					onkeydown={handleReviewResizeKeydown}
				></button>
				<div class="proposal-review__copy">
					<p>{proposalSummary}</p>
					{#if proposalAssumptions.length > 0}
						<div class="proposal-review__assumptions">
							<span>Assumptions</span>
							<ol>
								{#each proposalAssumptions as assumption}
									<li>{assumption}</li>
								{/each}
							</ol>
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
