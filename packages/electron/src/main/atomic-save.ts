import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

export function contentRevision(content: string): string {
	return createHash('sha256').update(content, 'utf8').digest('hex');
}

type AtomicSaveOptions = {
	target: string;
	content: string;
	expectedRevision: string;
	maxBytes: number;
	beforeCommit?: () => Promise<void>;
	beforeRename?: () => void;
};

export type AtomicSaveResult =
	| { status: 'saved'; revision: string }
	| { status: 'conflict' };

async function currentRevision(target: string): Promise<string | null> {
	try {
		return contentRevision(await readFile(target, 'utf8'));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
		throw error;
	}
}

export async function atomicSaveText(options: AtomicSaveOptions): Promise<AtomicSaveResult> {
	if (Buffer.byteLength(options.content, 'utf8') > options.maxBytes) {
		throw new Error('This edit is too large to save in Huzzah.');
	}
	if (await currentRevision(options.target) !== options.expectedRevision) return { status: 'conflict' };

	const temporary = join(dirname(options.target), `.huzzah-save-${basename(options.target)}-${randomUUID()}`);
	try {
		await writeFile(temporary, options.content, { encoding: 'utf8', mode: (await stat(options.target)).mode });
		await options.beforeCommit?.();
		if (await currentRevision(options.target) !== options.expectedRevision) return { status: 'conflict' };
		options.beforeRename?.();
		await rename(temporary, options.target);
	} finally {
		await unlink(temporary).catch(() => undefined);
	}
	return { status: 'saved', revision: contentRevision(options.content) };
}
