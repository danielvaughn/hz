<script lang="ts">
	import { LanguageDescription } from '@codemirror/language';
	import { languages } from '@codemirror/language-data';
	import { Compartment, EditorState, StateEffect, StateField, type Range } from '@codemirror/state';
	import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
	import { basicSetup } from 'codemirror';
	import { onMount } from 'svelte';
	import type { HighlightCategory, HighlightMark } from '../../shared/desktop';

	let { content, path, highlights = [], onChange }: { content: string; path: string; highlights?: HighlightMark[]; onChange?: (content: string) => void } = $props();
	let host: HTMLDivElement;
	let view: EditorView | null = null;
	const language = new Compartment();
	let languageRequest = 0;
	const setHighlights = StateEffect.define<HighlightMark[]>();

	function highlightDecoration(category: HighlightCategory): Decoration {
		return Decoration.mark({ class: `cm-intent-${category}` });
	}

	function highlightRanges(marks: HighlightMark[]): Range<Decoration>[] {
		return marks.slice().sort((left, right) => left.from - right.from || left.to - right.to)
			.map((mark) => highlightDecoration(mark.category).range(mark.from, mark.to));
	}

	const highlightField = StateField.define<DecorationSet>({
		create: () => Decoration.none,
		update(decorations, transaction) {
			let next = decorations.map(transaction.changes);
			for (const effect of transaction.effects) {
				if (effect.is(setHighlights)) next = Decoration.set(highlightRanges(effect.value), true);
			}
			return next;
		},
		provide: (field) => EditorView.decorations.from(field)
	});

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
			'.cm-foldPlaceholder': { backgroundColor: '#24251f', border: '1px solid #35372f', color: '#a6a89f' },
			'.cm-intent-action': { color: '#d9a66c' },
			'.cm-intent-object': { color: '#86b8d9' },
			'.cm-intent-condition': { color: '#c997c7' },
			'.cm-intent-value': { color: '#a8c98f' },
			'.cm-intent-identifier': { color: '#79b8b3' },
			'.cm-intent-control': { color: '#c88d87' },
			'.cm-intent-operator': { color: '#c9b477' },
			'.cm-intent-type': { color: '#8fa8d4' },
			'.cm-intent-comment': { color: '#77746e', fontStyle: 'italic' },
			'.cm-intent-directive': { color: '#d6d3d1', fontWeight: '600' },
			'.cm-intent-resource': { color: '#77aaa0' },
			'.cm-intent-modifier': { color: '#b5a5d2' }
		},
		{ dark: true }
	);

	onMount(() => {
		view = new EditorView({
			parent: host,
			state: EditorState.create({
				doc: content,
				extensions: [basicSetup, language.of([]), highlightField, theme, EditorView.updateListener.of((update) => {
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

	$effect(() => {
		if (view) view.dispatch({ effects: setHighlights.of(highlights) });
	});
</script>

<div class="code-viewer" bind:this={host}></div>

<style>
	.code-viewer { height: 100%; min-height: 0; }
</style>
