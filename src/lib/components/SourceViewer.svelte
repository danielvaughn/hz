<script lang="ts">
	import { javascript } from '@codemirror/lang-javascript';
	import { unifiedMergeView } from '@codemirror/merge';
	import { oneDark } from '@codemirror/theme-one-dark';
	import { basicSetup, EditorView } from 'codemirror';
	import { onMount } from 'svelte';

	type Props = {
		source: string;
		original?: string | null;
	};

	let { source, original = null }: Props = $props();
	let host: HTMLDivElement;

	const theme = EditorView.theme(
		{
			'&': {
				height: '100%',
				backgroundColor: 'transparent',
				color: '#c9c6c1',
				fontSize: '13px'
			},
			'.cm-scroller': {
				fontFamily: 'var(--font-mono)',
				lineHeight: '1.65',
				overflow: 'auto'
			},
			'.cm-content': {
				padding: '20px 0 40px'
			},
			'.cm-line': {
				padding: '0 24px 0 12px'
			},
			'.cm-gutters': {
				backgroundColor: 'transparent',
				border: 'none',
				color: '#454440'
			},
			'.cm-lineNumbers .cm-gutterElement': {
				minWidth: '38px',
				padding: '0 8px 0 12px'
			},
			'.cm-activeLine, .cm-activeLineGutter': {
				backgroundColor: 'transparent'
			},
			'&.cm-focused': {
				outline: 'none'
			},
			'.cm-selectionBackground, ::selection': {
				backgroundColor: 'rgba(168, 162, 158, 0.18)'
			}
		},
		{ dark: true }
	);

	onMount(() => {
		const view = new EditorView({
			doc: source,
			parent: host,
			extensions: [
				basicSetup,
				javascript(),
				oneDark,
				EditorView.lineWrapping,
				EditorView.editable.of(false),
				EditorView.contentAttributes.of({ 'aria-label': 'Generated JavaScript source' }),
				theme,
				...(original === null
					? []
					: unifiedMergeView({
							original,
							highlightChanges: false,
							gutter: true,
							mergeControls: false,
							allowInlineDiffs: true
						}))
			]
		});

		return () => view.destroy();
	});
</script>

<div class="source-viewer" bind:this={host}></div>

<style>
	.source-viewer {
		min-width: 0;
		min-height: 0;
		height: 100%;
		overflow: hidden;
	}

	.source-viewer :global(.cm-editor) {
		height: 100%;
		background-color: transparent !important;
	}

	.source-viewer :global(.cm-gutters) {
		background-color: transparent !important;
	}

	.source-viewer :global(.cm-activeLineGutter) {
		background-color: transparent !important;
	}
</style>
