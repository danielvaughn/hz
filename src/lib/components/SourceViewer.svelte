<script lang="ts">
	import { javascript } from '@codemirror/lang-javascript';
	import { unifiedMergeView } from '@codemirror/merge';
	import { oneDark } from '@codemirror/theme-one-dark';
	import { basicSetup, EditorView } from 'codemirror';
	import { StateEffect, StateField, type Text } from '@codemirror/state';
	import { Decoration, type DecorationSet } from '@codemirror/view';
	import { onMount } from 'svelte';

	import type { SourceMapRange } from '$lib/source-maps';

	type Props = {
		source: string;
		original?: string | null;
		highlightedRanges?: SourceMapRange[];
	};

	let { source, original = null, highlightedRanges = [] }: Props = $props();
	let host: HTMLDivElement;
	let view = $state.raw<EditorView>();

	const setSourceMapHighlights = StateEffect.define<SourceMapRange[]>();

	function positionToOffset(doc: Text, position: SourceMapRange['from']) {
		if (position.line < 1 || position.line > doc.lines) return null;
		const line = doc.line(position.line);
		if (position.column < 0 || position.column > line.length) return null;
		return line.from + position.column;
	}

	function sourceMapDecorations(doc: Text, ranges: SourceMapRange[]) {
		const decorations = [];
		const highlightedLines = new Set<number>();

		for (const range of ranges) {
			const from = positionToOffset(doc, range.from);
			const to = positionToOffset(doc, range.to);
			if (from === null || to === null || to < from) continue;

			let lastLine = range.to.line;
			if (range.to.column === 0 && lastLine > range.from.line) lastLine -= 1;
			for (let lineNumber = range.from.line; lineNumber <= lastLine; lineNumber += 1) {
				if (highlightedLines.has(lineNumber)) continue;
				highlightedLines.add(lineNumber);
				decorations.push(Decoration.line({ class: 'cm-source-map-line' }).range(doc.line(lineNumber).from));
			}

			if (to > from) {
				decorations.push(Decoration.mark({ class: 'cm-source-map-range' }).range(from, to));
			}
		}

		return Decoration.set(decorations, true);
	}

	const sourceMapField = StateField.define<DecorationSet>({
		create: () => Decoration.none,
		update(decorations, transaction) {
			let next = decorations.map(transaction.changes);
			for (const effect of transaction.effects) {
				if (effect.is(setSourceMapHighlights)) {
					next = sourceMapDecorations(transaction.state.doc, effect.value);
				}
			}
			return next;
		},
		provide: (field) => EditorView.decorations.from(field)
	});

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
			},
			'.cm-source-map-line': {
				backgroundColor: 'rgba(217, 166, 108, 0.115)',
				boxShadow: 'inset 2px 0 0 rgba(217, 166, 108, 0.72)'
			},
			'.cm-source-map-range': {
				backgroundColor: 'rgba(217, 166, 108, 0.14)',
				borderRadius: '2px'
			}
		},
		{ dark: true }
	);

	onMount(() => {
		view = new EditorView({
			doc: source,
			parent: host,
			extensions: [
				basicSetup,
				javascript(),
				oneDark,
				EditorView.lineWrapping,
				EditorView.editable.of(false),
				EditorView.contentAttributes.of({ 'aria-label': 'Generated JavaScript source' }),
				sourceMapField,
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

		return () => view?.destroy();
	});

	$effect(() => {
		if (!view) return;
		view.dispatch({ effects: setSourceMapHighlights.of(highlightedRanges) });
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
