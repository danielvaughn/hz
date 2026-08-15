export type ConsoleLevel = 'log' | 'info' | 'warn' | 'error';

export type ReplWorkerRequest =
	| { type: 'load'; source: string }
	| { type: 'execute'; id: string; code: string };

export type ReplWorkerResponse =
	| { type: 'loaded'; exports: string[] }
	| { type: 'scope'; replKeys: string[] }
	| { type: 'load-error'; message: string }
	| { type: 'console'; id: string | null; level: ConsoleLevel; text: string }
	| { type: 'result'; id: string; text: string }
	| { type: 'error'; id: string; message: string };
