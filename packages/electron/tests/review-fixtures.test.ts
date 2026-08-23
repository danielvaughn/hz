import assert from 'node:assert/strict';
import test from 'node:test';

import type { SyncSummary } from '../src/shared/desktop.ts';
import { buildReviewFixture } from '../src/main/review-fixtures.ts';

const summary: SyncSummary = {
	repositoryPath: '/fixture/repository',
	head: '0123456789abcdef0123456789abcdef01234567',
	changes: [
		{ kind: 'modified', path: 'hz/scheduler.hz' },
		{ kind: 'renamed', oldPath: 'hz/priority.hz', path: 'hz/task-priority.hz' }
	]
};

test('comprehensive fixture covers every file operation without mutating input', () => {
	const before = structuredClone(summary);
	const proposal = buildReviewFixture(summary);
	assert.equal(proposal.status, 'ready');
	if (proposal.status !== 'ready') return;
	assert.deepEqual(new Set(proposal.operations.map((file) => file.kind)), new Set(['create', 'modify', 'rename', 'delete']));
	assert.ok(proposal.operations.some((file) => file.binary));
	assert.ok(proposal.operations.some((file) => file.generatedMetadata));
	assert.ok(proposal.operations.filter((file) => !file.binary).every((file) => file.diff.length > 0));
	assert.deepEqual(summary, before);
});

test('fixture output is deterministic for the captured sync summary', () => {
	assert.deepEqual(buildReviewFixture(summary), buildReviewFixture(structuredClone(summary)));
});

test('large-diff fixture exercises complete diffs beyond a single viewport', () => {
	const proposal = buildReviewFixture(summary, 'large-diff');
	assert.equal(proposal.status, 'ready');
	if (proposal.status !== 'ready') return;
	const largeFile = proposal.operations.find((file) => !file.generatedMetadata);
	assert.ok(largeFile);
	assert.ok(largeFile.diff.length > 180);
	assert.ok(largeFile.diff.some((line) => line.kind === 'addition'));
	assert.ok(largeFile.diff.some((line) => line.kind === 'deletion'));
});

test('error fixture is retryable and retains the captured HEAD', () => {
	const proposal = buildReviewFixture(summary, 'error');
	assert.deepEqual(proposal, {
		status: 'error',
		fixture: 'error',
		capturedHead: summary.head,
		title: 'Proposal could not be prepared',
		message: 'The fixture reconciler returned an invalid rename operation. No repository files were changed.',
		retryable: true
	});
});
