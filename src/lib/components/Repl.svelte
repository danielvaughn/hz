<script lang="ts">
	import ReplInput from '$lib/components/ReplInput.svelte';
	import type { ConsoleLevel, ReplWorkerRequest, ReplWorkerResponse } from '$lib/repl/protocol';
	import { LoaderCircle, Play, RotateCcw, Square } from '@lucide/svelte';
	import { onMount, tick } from 'svelte';

	const EXECUTION_TIMEOUT = 5_000;
	const DEFAULT_COMMAND = 'program.main()';

	type EntryKind = 'input' | 'result' | 'console' | 'error';

	type Entry = {
		id: string;
		kind: EntryKind;
		text: string;
		level?: ConsoleLevel;
	};

	type Props = {
		source: string;
		initialCommand?: string;
		hint?: string;
	};

	let { source, initialCommand = '', hint = '' }: Props = $props();
	let worker: Worker | undefined;
	let loadedSource = '';
	let mounted = false;
	let output: HTMLDivElement;
	let commandInput: { focus: () => void };
	let entries = $state<Entry[]>([]);
	let command = $state('');
	let history = $state<string[]>([]);
	let historyIndex = $state(0);
	let programExports = $state<string[]>([]);
	let replKeys = $state<string[]>([]);
	let ready = $state(false);
	let busy = $state(false);
	let loading = $state(false);
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
				loading = false;
				ready = true;
				programExports = message.exports;
				if (initialCommand && !command && entries.length === 0) command = initialCommand;
				void tick().then(() => commandInput?.focus());
				break;
			case 'scope':
				replKeys = message.replKeys;
				break;
			case 'load-error':
				if (loadTimer) clearTimeout(loadTimer);
				loadTimer = undefined;
				loading = false;
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
		loading = false;
		ready = false;
		entries = [];
		programExports = [];
		replKeys = [];

		if (!nextSource.trim()) return;

		loading = true;
		worker = new Worker(new URL('../workers/repl.worker.ts', import.meta.url), { type: 'module' });
		worker.onmessage = handleWorkerMessage;
		worker.onerror = (event) => {
			if (loadTimer) clearTimeout(loadTimer);
			loadTimer = undefined;
			loading = false;
			ready = false;
			busy = false;
			append({ kind: 'error', text: event.message || 'The runtime stopped unexpectedly.' });
		};

		if (reason === 'timeout') {
			append({
				kind: 'error',
				text: `Execution exceeded ${EXECUTION_TIMEOUT / 1000} seconds. Runtime reset.`
			});
		}
		send({ type: 'load', source: nextSource });
		loadTimer = setTimeout(() => {
			worker?.terminate();
			worker = undefined;
			loading = false;
			ready = false;
			busy = false;
			append({ kind: 'error', text: `Program loading exceeded ${EXECUTION_TIMEOUT / 1000} seconds.` });
		}, EXECUTION_TIMEOUT);
	}

	function stopRuntime() {
		worker?.terminate();
		worker = undefined;
		if (executionTimer) clearTimeout(executionTimer);
		if (loadTimer) clearTimeout(loadTimer);
		executionTimer = undefined;
		loadTimer = undefined;
		pendingId = null;
		busy = false;
		loading = false;
		ready = false;
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

	function navigateHistory(direction: -1 | 1) {
		if (history.length === 0) return;

		if (direction === -1) {
			historyIndex = Math.max(0, historyIndex - 1);
			command = history[historyIndex] ?? '';
			return;
		}

		historyIndex = Math.min(history.length, historyIndex + 1);
		command = historyIndex === history.length ? '' : (history[historyIndex] ?? '');
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
		<button
			type="button"
			aria-label="Start runtime"
			title="Start runtime"
			disabled={loading || ready || !source.trim()}
			onclick={() => startRuntime(source)}
		>
			{#if loading}
				<LoaderCircle class="repl__spinner" size={13} strokeWidth={1.75} />
			{:else}
				<Play size={13} strokeWidth={1.75} />
			{/if}
		</button>
		<button
			type="button"
			aria-label="Stop runtime"
			title="Stop runtime"
			disabled={loading || !worker}
			onclick={stopRuntime}
		>
			<Square size={12} strokeWidth={1.75} />
		</button>
		<button
			type="button"
			aria-label="Restart runtime"
			title="Restart runtime"
			disabled={loading || !source.trim()}
			onclick={() => startRuntime(source, 'reset')}
		>
			<RotateCcw size={13} strokeWidth={1.75} />
		</button>
	</header>

	<div class="repl__output" bind:this={output} aria-live="polite" aria-label="REPL output">
		{#if hint && entries.length === 0}
			<div class="repl__hint">{hint}</div>
		{/if}
		{#each entries as entry (entry.id)}
			<div class:repl__entry--input={entry.kind === 'input'} class="repl__entry" data-kind={entry.kind} data-level={entry.level}>
				{#if entry.kind === 'input'}<span class="repl__marker">›</span>{/if}
				<pre>{entry.text}</pre>
			</div>
		{/each}
	</div>

	<div class="repl__input">
		<span aria-hidden="true">›</span>
		<ReplInput
			bind:this={commandInput}
			value={command}
			placeholder={source.trim() ? DEFAULT_COMMAND : 'Commit a program to begin'}
			disabled={!ready || busy}
			defaultValue={source.trim() ? DEFAULT_COMMAND : ''}
			{programExports}
			{replKeys}
			onchange={(value) => (command = value)}
			onsubmit={execute}
			onclear={() => (entries = [])}
			onhistory={navigateHistory}
		/>
	</div>
</div>

<style>
	.repl {
		display: grid;
		grid-template-rows: auto minmax(0, 1fr) auto;
		height: 100%;
		background: #090908;
		font-family: var(--font-mono);
	}

	.repl__toolbar {
		display: flex;
		align-items: center;
		min-height: 2.25rem;
		border-bottom: 1px solid rgba(231, 229, 228, 0.065);
	}

	.repl__toolbar button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		align-self: stretch;
		width: 2.375rem;
		padding: 0;
		border: 0;
		border-right: 1px solid rgba(231, 229, 228, 0.055);
		background: transparent;
		color: #77736c;
		cursor: pointer;
		transition:
			background-color 120ms ease,
			color 120ms ease;
	}

	.repl__toolbar button:hover:not(:disabled) {
		background: rgba(231, 229, 228, 0.04);
		color: #bbb6ae;
	}

	.repl__toolbar button:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.repl__toolbar button:focus-visible {
		outline: 1px solid rgba(231, 229, 228, 0.52);
		outline-offset: 2px;
	}

	.repl__spinner {
		animation: repl-spin 700ms linear infinite;
	}

	.repl__output {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		min-height: 0;
		padding: 1rem 1.25rem;
		overflow: auto;
	}

	.repl__hint {
		max-width: 30rem;
		margin: auto;
		color: #65625d;
		font-family: var(--font-sans);
		font-size: 0.75rem;
		line-height: 1.65;
		text-align: center;
	}

	.repl__entry {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 0.625rem;
		color: #bdb8b0;
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

	.repl__entry[data-kind='result'] {
		color: #d6d2cb;
	}

	.repl__entry[data-kind='error'],
	.repl__entry[data-level='error'] {
		color: #d38b80;
	}

	.repl__entry[data-level='warn'] {
		color: #d1aa69;
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
		min-height: var(--workspace-footer-height);
		padding: 0 1.25rem;
		border-top: 1px solid rgba(231, 229, 228, 0.075);
		background: #0b0b0a;
		font-size: 0.8125rem;
	}

	@keyframes repl-spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
