<script lang="ts">
	import { EditorState } from '@codemirror/state';
	import { EditorView } from '@codemirror/view';
	import { basicSetup } from 'codemirror';
	import { onMount } from 'svelte';

	let { content }: { content: string } = $props();
	let host: HTMLDivElement;

	const theme = EditorView.theme(
		{
			'&': { height: '100%', backgroundColor: 'transparent', color: '#d8d6d0', fontSize: '13px' },
			'.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.72', overflow: 'auto' },
			'.cm-content': { padding: '22px 0 64px' },
			'.cm-line': { padding: '0 28px 0 14px' },
			'.cm-gutters': { backgroundColor: '#121311', borderRight: '1px solid var(--line)', color: '#555850' },
			'.cm-lineNumbers .cm-gutterElement': { minWidth: '44px', padding: '0 10px 0 12px' },
			'.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'rgba(217, 164, 80, 0.035)' },
			'&.cm-focused': { outline: 'none' },
			'.cm-selectionBackground, ::selection': { backgroundColor: 'rgba(217, 164, 80, 0.18) !important' },
			'.cm-cursor': { display: 'none' },
			'.cm-foldPlaceholder': { backgroundColor: '#24251f', border: '1px solid #35372f', color: '#a6a89f' }
		},
		{ dark: true }
	);

	onMount(() => {
		const view = new EditorView({
			parent: host,
			state: EditorState.create({
				doc: content,
				extensions: [basicSetup, EditorState.readOnly.of(true), EditorView.editable.of(false), theme]
			})
		});
		return () => view.destroy();
	});
</script>

<div class="code-viewer" bind:this={host}></div>

<style>
	.code-viewer { height: 100%; min-height: 0; }
</style>
