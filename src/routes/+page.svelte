<script lang="ts">
	import IntentEditor from '$lib/components/IntentEditor.svelte';
	import { onMount } from 'svelte';

	const MIN_SPLIT = 20;
	const MAX_SPLIT = 80;
	const KEYBOARD_STEP = 2;
	const STORAGE_KEY = 'project:default';
	const SAVE_DELAY = 120;

	type PersistenceState = 'loading' | 'saved' | 'saving' | 'error';

	type StoredIntent = {
		version: 1;
		draftIntent: string;
		committedIntent: string;
	};

	let workspace: HTMLElement;
	let split = $state(50);
	let resizing = $state(false);
	let stacked = $state(false);
	let draftIntent = $state('');
	let committedIntent = $state('');
	let persistenceState = $state<PersistenceState>('loading');
	let storage: LocalForage | undefined;
	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	let saveRevision = 0;
	let hydrated = false;
	let editedBeforeHydration = false;

	let dirty = $derived(draftIntent !== committedIntent);
	let statusLabel = $derived.by(() => {
		if (persistenceState === 'loading') return 'Loading draft';
		if (persistenceState === 'error') return 'Storage unavailable';
		if (persistenceState === 'saving') return 'Saving draft';
		return dirty ? 'Uncommitted changes' : 'Synchronized';
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

	function handleKeydown(event: KeyboardEvent) {
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

	function handleIntentChange(value: string) {
		draftIntent = value;

		if (!hydrated || !storage) {
			editedBeforeHydration = true;
			return;
		}

		persistenceState = 'saving';
		const revision = ++saveRevision;
		const snapshot: StoredIntent = {
			version: 1,
			draftIntent,
			committedIntent
		};

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

	onMount(() => {
		const mediaQuery = window.matchMedia('(max-width: 48rem)');
		const updateOrientation = () => (stacked = mediaQuery.matches);

		updateOrientation();
		mediaQuery.addEventListener('change', updateOrientation);

		void (async () => {
			try {
				const { default: localforage } = await import('localforage');
				storage = localforage.createInstance({ name: 'hz', storeName: 'projects' });

				const storedIntent = await storage.getItem<StoredIntent>(STORAGE_KEY);
				if (storedIntent?.version === 1 && !editedBeforeHydration) {
					draftIntent = storedIntent.draftIntent;
					committedIntent = storedIntent.committedIntent;
				}

				hydrated = true;
				if (editedBeforeHydration) handleIntentChange(draftIntent);
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

			<button class="intent-status__commit" type="button" disabled title="Commit workflow coming next">
				Commit
			</button>
		</footer>
	</section>
	<div
		class="workspace__divider"
		role="separator"
		aria-label="Resize workspace panes"
		aria-orientation={stacked ? 'horizontal' : 'vertical'}
		aria-valuemin={MIN_SPLIT}
		aria-valuemax={MAX_SPLIT}
		aria-valuenow={Math.round(split)}
		tabindex="0"
		onpointerdown={handlePointerDown}
		onpointermove={handlePointerMove}
		onpointerup={handlePointerUp}
		onpointercancel={handlePointerUp}
		onkeydown={handleKeydown}
	></div>
	<section class="workspace__pane workspace__pane--output" aria-label="Output workspace"></section>
</main>
