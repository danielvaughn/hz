import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
	generatedArtifactPath,
	hashGeneratedText,
	loadGeneratedMetadata
} from '../src/main/generated-metadata.ts';

const fixtureRoot = join(import.meta.dirname, 'fixtures/generated-metadata');
const specificationPath = 'hz/nested/greeting.hz';
const artifactPath = generatedArtifactPath(specificationPath);

async function fixtureRepository(run: (root: string) => Promise<void>): Promise<void> {
	const root = await mkdtemp(join(tmpdir(), 'huzzah-generated-metadata-'));
	const paths = [specificationPath, 'src/greeting.ts', artifactPath];
	try {
		await Promise.all(paths.map(async (path) => {
			const target = join(root, path);
			await mkdir(dirname(target), { recursive: true });
			await writeFile(target, await readFile(join(fixtureRoot, path)));
		}));
		await run(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

test('normalizes line endings before hashing', () => {
	assert.equal(hashGeneratedText('one\r\ntwo\rthree\n'), hashGeneratedText('one\ntwo\nthree\n'));
});

test('mirrors safe nested specification paths beneath generated metadata', () => {
	assert.equal(generatedArtifactPath('hz/nested/example.hz'), '.huzzah/generated/hz/nested/example.hz.json');
	assert.throws(() => generatedArtifactPath('../example.hz'), /safe repository-relative/);
	assert.throws(() => generatedArtifactPath('/tmp/example.hz'), /safe repository-relative/);
	assert.throws(() => generatedArtifactPath('hz/example.txt'), /safe repository-relative/);
});

test('loads a checked-in current artifact and exposes only validated payloads', () => fixtureRepository(async (root) => {
	const state = await loadGeneratedMetadata(root, specificationPath);
	assert.equal(state.artifactStatus, 'ready');
	assert.deepEqual(state.highlighting, {
		status: 'current',
		marks: [{ from: 0, to: 6, category: 'action', text: 'Create' }]
	});
	assert.equal(state.sourceMaps[0]?.status, 'current');
	assert.equal(state.sourceMaps[0]?.mappings?.length, 1);
}));

test('classifies all metadata as stale after specification drift', () => fixtureRepository(async (root) => {
	await writeFile(join(root, specificationPath), 'Changed\n', 'utf8');
	const state = await loadGeneratedMetadata(root, specificationPath);
	assert.deepEqual(state.highlighting, { status: 'stale' });
	assert.deepEqual(state.sourceMaps, [{ path: 'src/greeting.ts', status: 'stale' }]);
}));

test('keeps highlighting current while classifying a changed source target as stale', () => fixtureRepository(async (root) => {
	await writeFile(join(root, 'src/greeting.ts'), 'x\n', 'utf8');
	const state = await loadGeneratedMetadata(root, specificationPath);
	assert.equal(state.highlighting.status, 'current');
	assert.deepEqual(state.sourceMaps, [{ path: 'src/greeting.ts', status: 'stale' }]);
}));

test('classifies missing and malformed source-map targets independently', () => fixtureRepository(async (root) => {
	await unlink(join(root, 'src/greeting.ts'));
	let state = await loadGeneratedMetadata(root, specificationPath);
	assert.equal(state.sourceMaps[0]?.status, 'missing');

	const artifact = JSON.parse(await readFile(join(root, artifactPath), 'utf8')) as { sourceMaps: unknown[] };
	artifact.sourceMaps.push({ path: '../../outside.ts', hash: '0'.repeat(64), mappings: [] });
	await writeFile(join(root, artifactPath), JSON.stringify(artifact), 'utf8');
	state = await loadGeneratedMetadata(root, specificationPath);
	assert.equal(state.sourceMaps[1]?.status, 'invalid');
	assert.equal(state.sourceMaps[1]?.mappings, undefined);
}));

test('rejects missing artifacts and unsupported schema versions', () => fixtureRepository(async (root) => {
	await unlink(join(root, artifactPath));
	assert.equal((await loadGeneratedMetadata(root, specificationPath)).artifactStatus, 'missing');

	await mkdir(dirname(join(root, artifactPath)), { recursive: true });
	await writeFile(join(root, artifactPath), JSON.stringify({ version: 2 }), 'utf8');
	const state = await loadGeneratedMetadata(root, specificationPath);
	assert.equal(state.artifactStatus, 'invalid');
	assert.match(state.message ?? '', /Unsupported generated artifact version/);
}));
