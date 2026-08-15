<script lang="ts">
	import { onMount } from 'svelte';

	const MIN_SPLIT = 20;
	const MAX_SPLIT = 80;
	const KEYBOARD_STEP = 2;

	let workspace: HTMLElement;
	let split = $state(50);
	let resizing = $state(false);
	let stacked = $state(false);

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

	onMount(() => {
		const mediaQuery = window.matchMedia('(max-width: 48rem)');
		const updateOrientation = () => (stacked = mediaQuery.matches);

		updateOrientation();
		mediaQuery.addEventListener('change', updateOrientation);

		return () => mediaQuery.removeEventListener('change', updateOrientation);
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
	<section class="workspace__pane workspace__pane--intent" aria-label="Intent workspace"></section>
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
