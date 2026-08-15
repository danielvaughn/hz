<script lang="ts">
	import { unifiedMergeView } from '@codemirror/merge';
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
				fontFamily:
					"'IBM Plex Mono', 'SFMono-Regular', 'Cascadia Code', 'Roboto Mono', Consolas, monospace",
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
				EditorView.lineWrapping,
				EditorView.editable.of(false),
				EditorView.contentAttributes.of({ 'aria-label': 'Generated JavaScript source' }),
				theme,
				...(original === null
					? []
					: unifiedMergeView({
							original,
							highlightChanges: true,
							gutter: true,
							mergeControls: false,
							allowInlineDiffs: true,
							collapseUnchanged: { margin: 3, minSize: 6 }
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
	}
</style>
