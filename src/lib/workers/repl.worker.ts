import type {
	ConsoleLevel,
	ReplWorkerRequest,
	ReplWorkerResponse
} from '$lib/repl/protocol';

type Program = Record<string, unknown>;

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
	...args: string[]
) => (...args: unknown[]) => Promise<unknown>;

let program: Program | null = null;
const repl: Record<string, unknown> = {};
let activeRequestId: string | null = null;

function send(message: ReplWorkerResponse) {
	self.postMessage(message);
}

function formatValue(value: unknown, depth = 0, seen = new WeakSet<object>()): string {
	if (value === undefined) return 'undefined';
	if (value === null) return 'null';
	if (typeof value === 'string') return JSON.stringify(value);
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	if (typeof value === 'bigint') return `${value}n`;
	if (typeof value === 'symbol') return value.toString();
	if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
	if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
	if (value instanceof Date) return `Date(${JSON.stringify(value.toISOString())})`;
	if (value instanceof RegExp) return value.toString();
	if (depth >= 4) return Array.isArray(value) ? '[…]' : '{…}';

	if (typeof value === 'object') {
		if (seen.has(value)) return '[Circular]';
		seen.add(value);

		if (Array.isArray(value)) {
			const items = value.slice(0, 50).map((item) => formatValue(item, depth + 1, seen));
			if (value.length > 50) items.push(`… ${value.length - 50} more`);
			return `[${items.join(', ')}]`;
		}

		if (value instanceof Map) {
			return `Map(${value.size}) ${formatValue(Object.fromEntries(value), depth + 1, seen)}`;
		}

		if (value instanceof Set) {
			return `Set(${value.size}) ${formatValue([...value], depth + 1, seen)}`;
		}

		const entries = Object.entries(value).slice(0, 50);
		const body = entries
			.map(([key, entry]) => `${key}: ${formatValue(entry, depth + 1, seen)}`)
			.join(', ');
		const suffix = Object.keys(value).length > 50 ? ', …' : '';
		return `{${body}${suffix}}`;
	}

	return String(value);
}

function formatConsoleValue(value: unknown) {
	return typeof value === 'string' ? value : formatValue(value);
}

for (const level of ['log', 'info', 'warn', 'error'] as const satisfies readonly ConsoleLevel[]) {
	console[level] = (...values: unknown[]) => {
		send({
			type: 'console',
			id: activeRequestId,
			level,
			text: values.map(formatConsoleValue).join(' ')
		});
	};
}

async function loadProgram(source: string) {
	activeRequestId = null;
	const moduleUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));

	try {
		program = (await import(/* @vite-ignore */ moduleUrl)) as Program;
		Object.assign(globalThis, { program, repl });
		send({ type: 'loaded', exports: Object.keys(program).sort() });
	} catch (error) {
		program = null;
		send({
			type: 'load-error',
			message: error instanceof Error ? error.stack || error.message : String(error)
		});
	} finally {
		URL.revokeObjectURL(moduleUrl);
	}
}

async function execute(id: string, code: string) {
	if (!program) {
		send({ type: 'error', id, message: 'No program is loaded.' });
		return;
	}

	activeRequestId = id;

	try {
		let evaluate: (...args: unknown[]) => Promise<unknown>;

		try {
			evaluate = new AsyncFunction('program', 'repl', `"use strict"; return (${code}\n);`);
		} catch (error) {
			if (!(error instanceof SyntaxError)) throw error;
			evaluate = new AsyncFunction('program', 'repl', `"use strict"; ${code}`);
		}

		const result = await evaluate(program, repl);
		send({ type: 'result', id, text: formatValue(result) });
	} catch (error) {
		send({
			type: 'error',
			id,
			message: error instanceof Error ? error.stack || error.message : String(error)
		});
	} finally {
		activeRequestId = null;
		send({ type: 'scope', replKeys: Object.keys(repl).sort() });
	}
}

self.onmessage = (event: MessageEvent<ReplWorkerRequest>) => {
	if (event.data.type === 'load') void loadProgram(event.data.source);
	else void execute(event.data.id, event.data.code);
};

export {};
