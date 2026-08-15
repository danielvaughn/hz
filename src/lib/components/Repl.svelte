<script lang="ts">
	import type { ConsoleLevel, ReplWorkerRequest, ReplWorkerResponse } from '$lib/repl/protocol';
	import { RotateCcw } from '@lucide/svelte';
	import { onMount, tick } from 'svelte';

	const EXECUTION_TIMEOUT = 5_000;

	type EntryKind = 'system' | 'input' | 'result' | 'console' | 'error';

	type Entry = {
		id: string;
		kind: EntryKind;
		text: string;
		level?: ConsoleLevel;
	};

	type Props = {
		source: string;
	};

	let { source }: Props = $props();
	let worker: Worker | undefined;
	let loadedSource = '';
	let mounted = false;
	let output: HTMLDivElement;
	let commandInput: HTMLInputElement;
	let entries = $state<Entry[]>([]);
	let command = $state('');
	let history = $state<string[]>([]);
	let historyIndex = $state(0);
	let ready = $state(false);
	let busy = $state(false);
	let pendingId: string | null = null;
	let executionTimer: ReturnType<typeof setTimeout> | undefined;
	let loadTimer: ReturnType<typeof setTimeout> | undefined;

	function append(entry: Omit<Entry, 'id'>) {
		entries = [...entries, { ...entry, id: crypto.randomUUID() }];
	}

	function send(message: ReplWorkerRequest) {
		worker?.postMessage(message);
	}

	function completeExecution(id: string) {
		if (id !== pendingId) return;
		if (executionTimer) clearTimeout(executionTimer);
		executionTimer = undefined;
		pendingId = null;
		busy = false;
		void tick().then(() => commandInput?.focus());
	}

	function handleWorkerMessage(event: MessageEvent<ReplWorkerResponse>) {
		const message = event.data;

		switch (message.type) {
			case 'loaded':
				if (loadTimer) clearTimeout(loadTimer);
				loadTimer = undefined;
				ready = true;
				append({
					kind: 'system',
					text:
						message.exports.length > 0
							? `Program loaded · ${message.exports.join(', ')}`
							: 'Program loaded · no named exports'
				});
				break;
			case 'load-error':
				if (loadTimer) clearTimeout(loadTimer);
				loadTimer = undefined;
				ready = false;
				append({ kind: 'error', text: message.message });
				break;
			case 'console':
				append({ kind: 'console', level: message.level, text: message.text });
				break;
			case 'result':
				append({ kind: 'result', text: message.text });
				completeExecution(message.id);
				break;
			case 'error':
				append({ kind: 'error', text: message.message });
				completeExecution(message.id);
				break;
		}
	}

	function startRuntime(nextSource: string, reason: 'source' | 'reset' | 'timeout' = 'source') {
		worker?.terminate();
		if (executionTimer) clearTimeout(executionTimer);
		if (loadTimer) clearTimeout(loadTimer);

		loadedSource = nextSource;
		pendingId = null;
		busy = false;
		ready = false;
		entries = [];

		if (!nextSource.trim()) {
			append({ kind: 'system', text: 'No program loaded' });
			return;
		}

		worker = new Worker(new URL('../workers/repl.worker.ts', import.meta.url), { type: 'module' });
		worker.onmessage = handleWorkerMessage;
		worker.onerror = (event) => {
			if (loadTimer) clearTimeout(loadTimer);
			loadTimer = undefined;
			ready = false;
			busy = false;
			append({ kind: 'error', text: event.message || 'The runtime stopped unexpectedly.' });
		};

		append({
			kind: reason === 'timeout' ? 'error' : 'system',
			text:
				reason === 'timeout'
					? `Execution exceeded ${EXECUTION_TIMEOUT / 1000} seconds. Runtime reset.`
					: reason === 'reset'
						? 'Resetting runtime…'
						: 'Loading program…'
		});
		send({ type: 'load', source: nextSource });
		loadTimer = setTimeout(() => {
			worker?.terminate();
			worker = undefined;
			ready = false;
			append({ kind: 'error', text: `Program loading exceeded ${EXECUTION_TIMEOUT / 1000} seconds.` });
		}, EXECUTION_TIMEOUT);
	}

	function execute() {
		const code = command.trim();
		if (!code || !ready || busy || !worker) return;

		const id = crypto.randomUUID();
		append({ kind: 'input', text: code });
		history = [...history.filter((item) => item !== code), code];
		historyIndex = history.length;
		command = '';
		busy = true;
		pendingId = id;
		send({ type: 'execute', id, code });

		executionTimer = setTimeout(() => {
			if (pendingId !== id) return;
			startRuntime(source, 'timeout');
		}, EXECUTION_TIMEOUT);
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			execute();
			return;
		}

		if (event.key === 'ArrowUp' && history.length > 0) {
			event.preventDefault();
			historyIndex = Math.max(0, historyIndex - 1);
			command = history[historyIndex] ?? '';
			return;
		}

		if (event.key === 'ArrowDown' && history.length > 0) {
			event.preventDefault();
			historyIndex = Math.min(history.length, historyIndex + 1);
			command = historyIndex === history.length ? '' : (history[historyIndex] ?? '');
		}
	}

	onMount(() => {
		mounted = true;
		startRuntime(source);

		return () => {
			mounted = false;
			worker?.terminate();
			if (executionTimer) clearTimeout(executionTimer);
			if (loadTimer) clearTimeout(loadTimer);
		};
	});

	$effect(() => {
		const nextSource = source;
		if (mounted && nextSource !== loadedSource) startRuntime(nextSource);
	});

	$effect(() => {
		entries.length;
		void tick().then(() => output?.scrollTo({ top: output.scrollHeight }));
	});
</script>

<div class="repl">
	<header class="repl__toolbar">
		<span>{ready ? 'Runtime ready' : 'Runtime offline'}</span>
		<button type="button" disabled={!source.trim()} onclick={() => startRuntime(source, 'reset')}>
			<RotateCcw size={12} strokeWidth={1.75} />
			Reset
		</button>
	</header>

	<div class="repl__output" bind:this={output} aria-live="polite" aria-label="REPL output">
		{#each entries as entry (entry.id)}
			<div class:repl__entry--input={entry.kind === 'input'} class="repl__entry" data-kind={entry.kind} data-level={entry.level}>
				{#if entry.kind === 'input'}<span class="repl__marker">›</span>{/if}
				<pre>{entry.text}</pre>
			</div>
		{/each}
	</div>

	<form class="repl__input" onsubmit={(event) => { event.preventDefault(); execute(); }}>
		<span aria-hidden="true">›</span>
		<input
			bind:this={commandInput}
			bind:value={command}
			type="text"
			aria-label="JavaScript expression"
			placeholder={source.trim() ? 'program.main()' : 'Commit a program to begin'}
			disabled={!ready || busy}
			autocomplete="off"
			spellcheck="false"
			onkeydown={handleKeydown}
		/>
	</form>
</div>

<style>
	.repl {
		display: grid;
		grid-template-rows: auto minmax(0, 1fr) auto;
		height: 100%;
		background: #090908;
	}

	.repl__toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-height: 2.25rem;
		padding: 0 0.75rem 0 1rem;
		border-bottom: 1px solid rgba(231, 229, 228, 0.065);
		color: #4f4c47;
		font-size: 0.625rem;
		letter-spacing: 0.045em;
	}

	.repl__toolbar button {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		min-height: 1.625rem;
		padding: 0 0.5rem;
		border: 1px solid rgba(231, 229, 228, 0.08);
		border-radius: 0.25rem;
		background: rgba(231, 229, 228, 0.025);
		color: #77736c;
		font-size: 0.625rem;
		cursor: pointer;
	}

	.repl__toolbar button:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.repl__toolbar button:focus-visible,
	.repl__input input:focus-visible {
		outline: 1px solid rgba(231, 229, 228, 0.52);
		outline-offset: 2px;
	}

	.repl__output {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		min-height: 0;
		padding: 1rem 1.25rem;
		overflow: auto;
	}

	.repl__entry {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 0.625rem;
		color: #8c8881;
		font-size: 0.75rem;
		line-height: 1.6;
	}

	.repl__entry pre {
		grid-column: 2;
		margin: 0;
		font: inherit;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.repl__entry:not(.repl__entry--input) pre {
		grid-column: 1 / -1;
		padding-left: 1.25rem;
	}

	.repl__entry[data-kind='system'] {
		color: #4f4c47;
		font-size: 0.6875rem;
	}

	.repl__entry[data-kind='result'] {
		color: #a7a39c;
	}

	.repl__entry[data-kind='error'],
	.repl__entry[data-level='error'] {
		color: #b77970;
	}

	.repl__entry[data-level='warn'] {
		color: #ad9162;
	}

	.repl__marker,
	.repl__input > span {
		color: #918a7e;
	}

	.repl__input {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		align-items: center;
		gap: 0.625rem;
		min-height: 2.875rem;
		padding: 0 1.25rem;
		border-top: 1px solid rgba(231, 229, 228, 0.075);
		background: #0b0b0a;
		font-size: 0.8125rem;
	}

	.repl__input input {
		width: 100%;
		padding: 0;
		border: 0;
		background: transparent;
		color: #cbc7c0;
		box-shadow: none;
		outline: none;
	}

	.repl__input input:disabled {
		color: #4d4a46;
		cursor: not-allowed;
	}

	.repl__input input::placeholder {
		color: #413f3b;
	}
</style>
