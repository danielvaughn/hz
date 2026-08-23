<script lang="ts">
	import { LanguageDescription } from '@codemirror/language';
	import { languages } from '@codemirror/language-data';
	import { Compartment, EditorState } from '@codemirror/state';
	import { EditorView } from '@codemirror/view';
	import { basicSetup } from 'codemirror';
	import { onMount } from 'svelte';

	let { content, path, onChange }: { content: string; path: string; onChange?: (content: string) => void } = $props();
	let host: HTMLDivElement;
	let view: EditorView | null = null;
	const language = new Compartment();
	let languageRequest = 0;

	async function applyLanguage(filePath: string): Promise<void> {
		const request = ++languageRequest;
		const lookupPath = filePath.toLowerCase().endsWith('.hz') ? `${filePath}.md` : filePath;
		const description = LanguageDescription.matchFilename(languages, lookupPath);
		const support = description ? await description.load() : [];
		if (request !== languageRequest || !view) return;
		view.dispatch({ effects: language.reconfigure(support) });
	}

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
			'.cm-cursor': { borderLeftColor: '#d9a450' },
			'.cm-foldPlaceholder': { backgroundColor: '#24251f', border: '1px solid #35372f', color: '#a6a89f' }
		},
		{ dark: true }
	);

	onMount(() => {
		view = new EditorView({
			parent: host,
			state: EditorState.create({
				doc: content,
				extensions: [basicSetup, language.of([]), theme, EditorView.updateListener.of((update) => {
					if (update.docChanged) onChange?.(update.state.doc.toString());
				})]
			})
		});
		return () => { view?.destroy(); view = null; };
	});

	$effect(() => {
		if (!view || view.state.doc.toString() === content) return;
		view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } });
	});

	$effect(() => {
		if (view) void applyLanguage(path);
	});
</script>

<div class="code-viewer" bind:this={host}></div>

<style>
	.code-viewer { height: 100%; min-height: 0; }
</style>
