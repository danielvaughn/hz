<script lang="ts">
	import { basicSetup, EditorView } from 'codemirror';
	import { onMount } from 'svelte';

	type Props = {
		value: string;
		onchange: (value: string) => void;
	};

	let { value, onchange }: Props = $props();
	let host: HTMLDivElement;
	let view = $state.raw<EditorView>();
	let applyingExternalValue = false;

	const theme = EditorView.theme(
		{
			'&': {
				height: '100%',
				backgroundColor: 'transparent',
				color: '#d6d3d1',
				fontSize: '14px'
			},
			'.cm-scroller': {
				fontFamily:
					"'IBM Plex Mono', 'SFMono-Regular', 'Cascadia Code', 'Roboto Mono', Consolas, monospace",
				lineHeight: '1.65',
				overflow: 'auto'
			},
			'.cm-content': {
				padding: '24px 0 40px',
				caretColor: '#e7e5e4'
			},
			'.cm-line': {
				padding: '0 24px 0 12px'
			},
			'.cm-gutters': {
				backgroundColor: 'transparent',
				border: 'none',
				color: '#4f4e4a'
			},
			'.cm-lineNumbers .cm-gutterElement': {
				minWidth: '38px',
				padding: '0 8px 0 12px'
			},
			'.cm-activeLine, .cm-activeLineGutter': {
				backgroundColor: 'rgba(231, 229, 228, 0.025)'
			},
			'&.cm-focused': {
				outline: 'none'
			},
			'&.cm-focused .cm-cursor': {
				borderLeftColor: '#e7e5e4'
			},
			'&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
				backgroundColor: 'rgba(168, 162, 158, 0.22)'
			}
		},
		{ dark: true }
	);

	onMount(() => {
		view = new EditorView({
			doc: value,
			parent: host,
			extensions: [
				basicSetup,
				EditorView.lineWrapping,
				EditorView.contentAttributes.of({ 'aria-label': 'Intent editor' }),
				theme,
				EditorView.updateListener.of((update) => {
					if (update.docChanged && !applyingExternalValue) onchange(update.state.doc.toString());
				})
			]
		});

		return () => view?.destroy();
	});

	$effect(() => {
		if (!view || value === view.state.doc.toString()) return;

		applyingExternalValue = true;
		view.dispatch({
			changes: { from: 0, to: view.state.doc.length, insert: value }
		});
		applyingExternalValue = false;
	});
</script>

<div class="intent-editor" bind:this={host}></div>

<style>
	.intent-editor {
		min-width: 0;
		min-height: 0;
		height: 100%;
		overflow: hidden;
	}

	.intent-editor :global(.cm-editor) {
		height: 100%;
	}
</style>
