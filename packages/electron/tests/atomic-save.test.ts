import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { atomicSaveText, contentRevision } from '../src/main/atomic-save.ts';

async function withFile(run: (directory: string, target: string) => Promise<void>): Promise<void> {
	const directory = await mkdtemp(join(tmpdir(), 'huzzah-atomic-save-'));
	const target = join(directory, 'example.ts');
	await writeFile(target, 'original', 'utf8');
	try { await run(directory, target); } finally { await rm(directory, { recursive: true, force: true }); }
}

test('atomically replaces a file when its revision is current', () => withFile(async (_directory, target) => {
	const result = await atomicSaveText({ target, content: 'edited', expectedRevision: contentRevision('original'), maxBytes: 1024 });
	assert.deepEqual(result, { status: 'saved', revision: contentRevision('edited') });
	assert.equal(await readFile(target, 'utf8'), 'edited');
}));

test('does not overwrite a file with a stale revision', () => withFile(async (_directory, target) => {
	const result = await atomicSaveText({ target, content: 'edited', expectedRevision: contentRevision('stale'), maxBytes: 1024 });
	assert.deepEqual(result, { status: 'conflict' });
	assert.equal(await readFile(target, 'utf8'), 'original');
}));

test('detects a change that lands while the temporary file is being written', () => withFile(async (_directory, target) => {
	const result = await atomicSaveText({
		target,
		content: 'edited',
		expectedRevision: contentRevision('original'),
		maxBytes: 1024,
		beforeCommit: () => writeFile(target, 'external', 'utf8')
	});
	assert.deepEqual(result, { status: 'conflict' });
	assert.equal(await readFile(target, 'utf8'), 'external');
}));

test('leaves the original intact and cleans up when a save fails', () => withFile(async (directory, target) => {
	await assert.rejects(() => atomicSaveText({
		target,
		content: 'edited',
		expectedRevision: contentRevision('original'),
		maxBytes: 1024,
		beforeCommit: async () => { throw new Error('injected failure'); }
	}), /injected failure/);
	assert.equal(await readFile(target, 'utf8'), 'original');
	assert.deepEqual(await readdir(directory), ['example.ts']);
}));
