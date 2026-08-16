<script lang="ts">
	import { basicSetup, EditorView } from 'codemirror';
	import { indentWithTab } from '@codemirror/commands';
	import { indentUnit } from '@codemirror/language';
	import {
		ChangeDesc,
		EditorState,
		StateEffect,
		StateField,
		type Range,
		type Text
	} from '@codemirror/state';
	import { Decoration, keymap, type DecorationSet } from '@codemirror/view';
	import { onMount } from 'svelte';

	import {
		HIGHLIGHT_TAXONOMY_VERSION,
		mergeHighlightRanges,
		validHighlightMarks,
		type HighlightCategory,
		type HighlightMark,
		type HighlightRange,
		type HighlightResponse,
		type PersistedHighlighting
	} from '$lib/highlighting';

	type Props = {
		value: string;
		highlighting?: PersistedHighlighting | null;
		onchange: (value: string) => void;
		onhighlightingchange: (highlighting: PersistedHighlighting, persistImmediately?: boolean) => void;
		ontogglesourcemap: () => void;
		onintentlinechange: (line: number) => void;
	};

	let {
		value,
		highlighting,
		onchange,
		onhighlightingchange,
		ontogglesourcemap,
		onintentlinechange
	}: Props = $props();
	let host: HTMLDivElement;
	let view = $state.raw<EditorView>();
	let applyingExternalValue = false;
	let initializedHighlighting = false;
	let dirtyRanges: HighlightRange[] = [];
	let highlightRequest: AbortController | undefined;

	const restoreHighlights = StateEffect.define<HighlightMark[]>();
	const replaceHighlights = StateEffect.define<{
		ranges: HighlightRange[];
		marks: HighlightMark[];
	}>();
	const suppressChangeInvalidation = StateEffect.define<boolean>();

	function expandToBlock(doc: Text, from: number, to: number): HighlightRange | null {
		if (doc.length === 0) return null;

		const boundedFrom = Math.max(0, Math.min(from, doc.length));
		const boundedTo = Math.max(boundedFrom, Math.min(to, doc.length));
		let firstLine = doc.lineAt(boundedFrom);
		let lastLine = doc.lineAt(boundedTo);

		while (firstLine.number > 1) {
			const previous = doc.line(firstLine.number - 1);
			if (previous.text.trim().length === 0) break;
			firstLine = previous;
		}

		while (lastLine.number < doc.lines) {
			const next = doc.line(lastLine.number + 1);
			if (next.text.trim().length === 0) break;
			lastLine = next;
		}

		return { from: firstLine.from, to: lastLine.to };
	}

	function changedBlocks(doc: Text, changes: ChangeDesc) {
		const ranges: HighlightRange[] = [];
		changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
			const range = expandToBlock(doc, fromB, toB);
			if (range) ranges.push(range);
		});
		return mergeHighlightRanges(ranges);
	}

	function mapDirtyRanges(ranges: HighlightRange[], changes: ChangeDesc, doc: Text) {
		const mapped = ranges.flatMap((range) => {
			const from = changes.mapPos(range.from, -1);
			const to = changes.mapPos(range.to, 1);
			const expanded = expandToBlock(doc, from, to);
			return expanded ? [expanded] : [];
		});
		return mergeHighlightRanges([...mapped, ...changedBlocks(doc, changes)]);
	}

	function highlightDecoration(category: HighlightCategory) {
		return Decoration.mark({
			class: `cm-intent-${category}`,
			attributes: { 'data-highlight-category': category },
			category
		});
	}

	function decorationRangesFromMarks(marks: HighlightMark[]): Range<Decoration>[] {
		return marks
			.slice()
			.sort((left, right) => left.from - right.from || left.to - right.to)
			.map((mark) => highlightDecoration(mark.category).range(mark.from, mark.to));
	}

	function decorationSetFromMarks(marks: HighlightMark[]) {
		return Decoration.set(decorationRangesFromMarks(marks), true);
	}

	function removeDecorationsInRanges(decorations: DecorationSet, ranges: HighlightRange[]) {
		if (ranges.length === 0) return decorations;

		const retained: Range<Decoration>[] = [];
		decorations.between(0, Number.MAX_SAFE_INTEGER, (from, to, decoration) => {
			if (!ranges.some((range) => from < range.to && to > range.from)) {
				retained.push(decoration.range(from, to));
			}
		});
		return Decoration.set(retained, true);
	}

	const highlightField = StateField.define<DecorationSet>({
		create: () => Decoration.none,
		update(decorations, transaction) {
			let next = decorations.map(transaction.changes);
			const suppressInvalidation = transaction.effects.some((effect) =>
				effect.is(suppressChangeInvalidation)
			);

			if (transaction.docChanged && !suppressInvalidation) {
				next = removeDecorationsInRanges(next, changedBlocks(transaction.newDoc, transaction.changes));
			}

			for (const effect of transaction.effects) {
				if (effect.is(restoreHighlights)) next = decorationSetFromMarks(effect.value);
				if (effect.is(replaceHighlights)) {
					next = removeDecorationsInRanges(next, effect.value.ranges).update({
						add: decorationRangesFromMarks(effect.value.marks)
					});
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
				color: '#d6d3d1',
				fontSize: '14px'
			},
			'.cm-scroller': {
				fontFamily: 'var(--font-mono)',
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
			},
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

	function serializeHighlighting(): PersistedHighlighting | null {
		if (!view) return null;

		const sourceText = view.state.doc.toString();
		const marks: HighlightMark[] = [];
		view.state.field(highlightField).between(0, sourceText.length, (from, to, decoration) => {
			const category = decoration.spec.category as HighlightCategory | undefined;
			if (!category) return;
			marks.push({ from, to, category, text: sourceText.slice(from, to) });
		});

		return {
			version: 1,
			taxonomyVersion: HIGHLIGHT_TAXONOMY_VERSION,
			sourceText,
			marks,
			dirtyRanges: dirtyRanges.map((range) => ({ ...range }))
		};
	}

	function publishHighlighting(persistImmediately = false) {
		const snapshot = serializeHighlighting();
		if (snapshot) onhighlightingchange(snapshot, persistImmediately);
	}

	function stopPendingHighlight() {
		highlightRequest?.abort();
		highlightRequest = undefined;
	}

	async function runHighlight() {
		if (!view || dirtyRanges.length === 0) return;

		const requestedText = view.state.doc.toString();
		const requestedRanges = dirtyRanges.map((range) => ({ ...range }));
		const controller = new AbortController();
		highlightRequest = controller;

		try {
			const response = await fetch('/api/highlight', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ text: requestedText, ranges: requestedRanges }),
				signal: controller.signal
			});
			const result = (await response.json()) as HighlightResponse | { error?: string };

			if (!response.ok || !('marks' in result)) throw new Error('Highlighting failed.');
			if (!view || view.state.doc.toString() !== requestedText) return;

			const marks = validHighlightMarks(requestedText, result.marks).filter((mark) =>
				requestedRanges.some((range) => mark.from >= range.from && mark.to <= range.to)
			);
			view.dispatch({ effects: replaceHighlights.of({ ranges: requestedRanges, marks }) });
			dirtyRanges = [];
			publishHighlighting(true);
		} catch (error) {
			if (!(error instanceof DOMException && error.name === 'AbortError')) {
				// Keep dirty ranges persisted so a later edit or reload can retry them.
				publishHighlighting();
			}
		} finally {
			if (highlightRequest === controller) highlightRequest = undefined;
		}
	}

	export async function generateHighlighting(forceFullDocument = false) {
		if (!view || view.state.doc.length === 0) return;
		stopPendingHighlight();

		if (forceFullDocument) {
			dirtyRanges = [{ from: 0, to: view.state.doc.length }];
			view.dispatch({
				effects: replaceHighlights.of({ ranges: dirtyRanges, marks: [] })
			});
			publishHighlighting();
		}

		await runHighlight();
	}

	onMount(() => {
		view = new EditorView({
			doc: value,
			parent: host,
			extensions: [
				basicSetup,
				indentUnit.of('    '),
				EditorState.tabSize.of(4),
				keymap.of([
					{
						key: 'Mod-.',
						run: () => {
							ontogglesourcemap();
							return true;
						}
					},
					indentWithTab
				]),
				EditorView.lineWrapping,
				EditorView.contentAttributes.of({ 'aria-label': 'Intent editor' }),
				highlightField,
				theme,
				EditorView.updateListener.of((update) => {
					if (update.selectionSet || update.docChanged) {
						onintentlinechange(update.state.doc.lineAt(update.state.selection.main.head).number);
					}
					if (!update.docChanged || applyingExternalValue) return;

					dirtyRanges = mapDirtyRanges(dirtyRanges, update.changes, update.state.doc);
					stopPendingHighlight();
					onchange(update.state.doc.toString());
					publishHighlighting();
				})
			]
		});
		onintentlinechange(view.state.doc.lineAt(view.state.selection.main.head).number);

		return () => {
			stopPendingHighlight();
			view?.destroy();
		};
	});

	$effect(() => {
		if (!view || value === view.state.doc.toString()) return;

		applyingExternalValue = true;
		view.dispatch({
			changes: { from: 0, to: view.state.doc.length, insert: value },
			effects: suppressChangeInvalidation.of(true)
		});
		applyingExternalValue = false;
	});

	$effect(() => {
		if (!view || initializedHighlighting || highlighting === undefined) return;
		initializedHighlighting = true;

		const sourceText = view.state.doc.toString();
		const canRestore =
			highlighting !== null &&
			highlighting.version === 1 &&
			highlighting.taxonomyVersion === HIGHLIGHT_TAXONOMY_VERSION &&
			highlighting.sourceText === sourceText;
		const restoredMarks = canRestore ? validHighlightMarks(sourceText, highlighting.marks) : [];
		const allMarksValid = canRestore && restoredMarks.length === highlighting.marks.length;

		if (allMarksValid) {
			dirtyRanges = mergeHighlightRanges(
				highlighting.dirtyRanges.filter(
					(range) => range.from >= 0 && range.from < range.to && range.to <= sourceText.length
				)
			);
		} else {
			dirtyRanges = sourceText.length > 0 ? [{ from: 0, to: sourceText.length }] : [];
		}

		view.dispatch({ effects: restoreHighlights.of(allMarksValid ? restoredMarks : []) });
		publishHighlighting();
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
