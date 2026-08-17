<script lang="ts">
	import {
		autocompletion,
		completionStatus,
		type Completion,
		type CompletionContext
	} from '@codemirror/autocomplete';
	import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
	import { javascript } from '@codemirror/lang-javascript';
	import { Compartment, Prec } from '@codemirror/state';
	import {
		highlightSpecialChars,
		keymap,
		placeholder as placeholderExtension
	} from '@codemirror/view';
	import { EditorView } from 'codemirror';
	import { onMount } from 'svelte';

	type Props = {
		value: string;
		disabled: boolean;
		placeholder: string;
		defaultValue: string;
		programExports: string[];
		bareProgramExports: string[];
		replKeys: string[];
		onchange: (value: string) => void;
		onsubmit: () => void;
		onclear: () => void;
		onhistory: (direction: -1 | 1) => void;
	};

	let {
		value,
		disabled,
		placeholder,
		defaultValue,
		programExports,
		bareProgramExports,
		replKeys,
		onchange,
		onsubmit,
		onclear,
		onhistory
	}: Props = $props();

	let host: HTMLDivElement;
	let view = $state.raw<EditorView>();
	let applyingExternalValue = false;
	let configuredDisabled: boolean;
	let configuredPlaceholder: string;
	const editable = new Compartment();
	const placeholderSlot = new Compartment();

	function uniqueOptions(values: string[]): Completion[] {
		return [...new Set(values)].sort().map((label) => ({ label, type: 'property' }));
	}

	function completions(context: CompletionContext) {
		const beforeCursor = context.state.doc.sliceString(
			context.state.doc.lineAt(context.pos).from,
			context.pos
		);
		const member = beforeCursor.match(/(?:^|[^\w$])(program|repl)\.([\w$]*)$/);

		if (member) {
			const prefix = member[2] ?? '';
			return {
				from: context.pos - prefix.length,
				options: uniqueOptions(member[1] === 'program' ? programExports : replKeys),
				validFor: /^[\w$]*$/
			};
		}

		const topLevel = context.matchBefore(/[\w$]*/);
		if (!topLevel || (!context.explicit && topLevel.from === topLevel.to)) return null;

		return {
			from: topLevel.from,
			options: [
				...uniqueOptions(bareProgramExports),
				{ label: 'program', type: 'variable', detail: 'module exports' },
				{ label: 'repl', type: 'variable', detail: 'session state' }
			],
			validFor: /^[\w$]*$/
		};
	}

	function replaceValue(nextValue: string) {
		if (!view) return;

		view.dispatch({
			changes: { from: 0, to: view.state.doc.length, insert: nextValue },
			selection: { anchor: nextValue.length }
		});
	}

	function useDefault(view: EditorView) {
		if (completionStatus(view.state) || view.state.doc.length > 0 || !defaultValue) return false;
		replaceValue(defaultValue);
		return true;
	}

	export function focus() {
		view?.focus();
	}

	const theme = EditorView.theme(
		{
			'&': {
				width: '100%',
				height: '1.6em',
				backgroundColor: 'transparent',
				color: '#cbc7c0',
				fontSize: '13px'
			},
			'.cm-scroller': {
				fontFamily: 'var(--font-mono)',
				lineHeight: '1.6',
				overflow: 'hidden'
			},
			'.cm-content': {
				padding: '0',
				caretColor: '#e7e5e4'
			},
			'.cm-line': { padding: '0' },
			'.cm-placeholder': { color: '#55524d' },
			'&.cm-focused': { outline: 'none' },
			'&.cm-focused .cm-cursor': { borderLeftColor: '#e7e5e4' },
			'&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
				backgroundColor: 'rgba(168, 162, 158, 0.22)'
			},
			'.cm-tooltip-autocomplete': {
				border: '1px solid rgba(231, 229, 228, 0.12)',
				borderRadius: '4px',
				backgroundColor: '#151513',
				boxShadow: '0 12px 32px rgba(0, 0, 0, 0.45)',
				overflow: 'hidden'
			},
			'.cm-tooltip-autocomplete > ul': {
				fontFamily: 'var(--font-mono)',
				fontSize: '12px',
				maxHeight: '220px'
			},
			'.cm-tooltip-autocomplete > ul > li': {
				padding: '5px 9px',
				color: '#aaa59d'
			},
			'.cm-tooltip-autocomplete > ul > li[aria-selected]': {
				backgroundColor: 'rgba(231, 229, 228, 0.09)',
				color: '#e0ddd7'
			},
			'.cm-completionDetail': { color: '#706c65', fontStyle: 'normal' }
		},
		{ dark: true }
	);

	onMount(() => {
		configuredDisabled = disabled;
		configuredPlaceholder = placeholder;
		view = new EditorView({
			doc: value,
			parent: host,
			extensions: [
				highlightSpecialChars(),
				history(),
				keymap.of([...defaultKeymap, ...historyKeymap]),
				javascript(),
				autocompletion({ override: [completions], activateOnTyping: true }),
				Prec.highest(
					keymap.of([
						{
							key: 'Mod-k',
							run: () => {
								onclear();
								return true;
							}
						},
						{
							key: 'Enter',
							run: (editor) => {
								if (completionStatus(editor.state)) return false;
								onsubmit();
								return true;
							}
						},
						{
							key: 'ArrowUp',
							run: (editor) => {
								if (completionStatus(editor.state)) return false;
								onhistory(-1);
								return true;
							}
						},
						{
							key: 'ArrowDown',
							run: (editor) => {
								if (completionStatus(editor.state)) return false;
								onhistory(1);
								return true;
							}
						},
						{ key: 'Tab', run: useDefault },
						{ key: 'ArrowRight', run: useDefault }
					])
				),
				EditorView.contentAttributes.of({
					'aria-label': 'JavaScript expression',
					'autocapitalize': 'off',
					'autocomplete': 'off',
					'spellcheck': 'false'
				}),
				EditorView.updateListener.of((update) => {
					if (update.docChanged && !applyingExternalValue) onchange(update.state.doc.toString());
				}),
				EditorView.theme({ '.cm-content': { whiteSpace: 'pre' } }),
				EditorView.domEventHandlers({
					paste(event, editor) {
						const text = event.clipboardData?.getData('text/plain');
						if (!text || (!text.includes('\n') && !text.includes('\r'))) return false;
						event.preventDefault();
						editor.dispatch(editor.state.replaceSelection(text.replace(/\s*\r?\n\s*/g, ' ')));
						return true;
					}
				}),
				editable.of(EditorView.editable.of(!disabled)),
				placeholderSlot.of(placeholderExtension(placeholder)),
				theme
			]
		});

		return () => view?.destroy();
	});

	$effect(() => {
		if (!view || value === view.state.doc.toString()) return;

		applyingExternalValue = true;
		replaceValue(value);
		applyingExternalValue = false;
	});

	$effect(() => {
		if (!view || disabled === configuredDisabled) return;

		configuredDisabled = disabled;
		view.dispatch({ effects: editable.reconfigure(EditorView.editable.of(!disabled)) });
	});

	$effect(() => {
		if (!view || placeholder === configuredPlaceholder) return;

		configuredPlaceholder = placeholder;
		view.dispatch({ effects: placeholderSlot.reconfigure(placeholderExtension(placeholder)) });
	});
</script>

<div class="repl-command" class:repl-command--disabled={disabled} bind:this={host}></div>

<style>
	.repl-command {
		position: relative;
		min-width: 0;
	}

	.repl-command--disabled {
		opacity: 0.42;
	}
</style>
