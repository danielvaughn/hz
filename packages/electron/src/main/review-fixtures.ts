import type {
	ProposalDiffLine,
	ProposalFileOperation,
	ReviewFixtureName,
	ReviewProposal,
	SyncSummary
} from '../shared/desktop';

function lines(value: Array<[ProposalDiffLine['kind'], string, number?, number?]>): ProposalDiffLine[] {
	return value.map(([kind, text, oldLine, newLine]) => ({ kind, text, oldLine, newLine }));
}

const operations = (): ProposalFileOperation[] => [
	{
		id: 'modify-scheduler', kind: 'modify', path: 'src/scheduler.ts', generatedMetadata: false, binary: false,
		additions: 7, deletions: 2,
		diff: lines([
			['header', '@@ -18,8 +18,13 @@ export function chooseTask(tasks: Task[]) {'],
			['context', ' export function chooseTask(tasks: Task[]) {', 18, 18],
			['deletion', '-  return tasks.sort((a, b) => b.urgency - a.urgency)[0];', 19],
			['addition', '+  return tasks', undefined, 19],
			['addition', '+    .filter((task) => !task.blocked)', undefined, 20],
			['addition', '+    .sort((a, b) => {', undefined, 21],
			['addition', '+      const deadline = a.deadline.localeCompare(b.deadline);', undefined, 22],
			['addition', '+      return deadline || b.urgency - a.urgency;', undefined, 23],
			['addition', '+    })[0];', undefined, 24],
			['context', ' }', 20, 25],
			['deletion', '-// Tasks are ranked by urgency.', 22],
			['addition', '+// Unblocked tasks are ranked by deadline, then urgency.', undefined, 27]
		])
	},
	{
		id: 'create-test', kind: 'create', path: 'src/scheduler.test.ts', generatedMetadata: false, binary: false,
		additions: 9, deletions: 0,
		diff: lines([
			['header', '@@ -0,0 +1,9 @@'],
			['addition', "+import { describe, expect, it } from 'vitest';", undefined, 1],
			['addition', "+import { chooseTask } from './scheduler';", undefined, 2],
			['addition', '+', undefined, 3],
			['addition', "+describe('chooseTask', () => {", undefined, 4],
			['addition', "+  it('skips blocked work', () => {", undefined, 5],
			['addition', "+    const result = chooseTask([{ urgency: 10, blocked: true }, { urgency: 4, blocked: false }]);", undefined, 6],
			['addition', '+    expect(result?.urgency).toBe(4);', undefined, 7],
			['addition', '+  });', undefined, 8],
			['addition', '+});', undefined, 9]
		])
	},
	{
		id: 'rename-priority', kind: 'rename', oldPath: 'src/priority.ts', path: 'src/task-priority.ts', generatedMetadata: false, binary: false,
		additions: 2, deletions: 1,
		diff: lines([
			['header', '@@ -1,4 +1,5 @@'],
			['deletion', '-export const priorityScore = (urgency: number) => urgency;', 1],
			['addition', '+export const priorityScore = (urgency: number, effort = 1) =>', undefined, 1],
			['addition', '+  urgency / Math.max(effort, 1);', undefined, 2],
			['context', ' ', 2, 3],
			['context', ' export type Priority = ReturnType<typeof priorityScore>;', 3, 4]
		])
	},
	{
		id: 'delete-legacy', kind: 'delete', path: 'src/legacy-ranker.ts', generatedMetadata: false, binary: false,
		additions: 0, deletions: 4,
		diff: lines([
			['header', '@@ -1,4 +0,0 @@'],
			['deletion', '-export function rankByInsertionOrder<T>(tasks: T[]): T[] {', 1],
			['deletion', '-  return [...tasks];', 2],
			['deletion', '-}', 3],
			['deletion', '-', 4]
		])
	},
	{
		id: 'create-binary', kind: 'create', path: 'public/icons/sync-state.png', generatedMetadata: false, binary: true,
		additions: 0, deletions: 0, diff: []
	},
	{
		id: 'metadata', kind: 'modify', path: '.huzzah/generated/hz/scheduler.hz.json', generatedMetadata: true, binary: false,
		additions: 14, deletions: 8,
		diff: lines([
			['header', '@@ -2,8 +2,14 @@'],
			['context', '   "version": 1,', 2, 2],
			['deletion', '-  "specificationHash": "91d5…",', 3],
			['addition', '+  "specificationHash": "2af8…",', undefined, 3],
			['deletion', '-  "sourceMaps": []', 4],
			['addition', '+  "sourceMaps": [', undefined, 4],
			['addition', '+    { "path": "src/scheduler.ts", "mappings": [', undefined, 5],
			['addition', '+      { "specification": { "from": 1, "to": 8 },', undefined, 6],
			['addition', '+        "source": [{ "from": 18, "to": 27 }] }', undefined, 7],
			['addition', '+    ] }', undefined, 8],
			['addition', '+  ]', undefined, 9],
			['context', ' }', 5, 10]
		])
	}
];

function largeOperation(): ProposalFileOperation {
	const diff: ProposalDiffLine[] = [{ kind: 'header', text: '@@ -1,120 +1,180 @@' }];
	for (let line = 1; line <= 180; line += 1) {
		if (line % 9 === 0) diff.push({ kind: 'deletion', text: `-  legacyStep(${line});`, oldLine: line });
		diff.push({
			kind: line % 4 === 0 ? 'addition' : 'context',
			text: `${line % 4 === 0 ? '+' : ' '}  executeStep(${line});`,
			oldLine: line % 4 === 0 ? undefined : line,
			newLine: line
		});
	}
	return {
		id: 'large-runtime', kind: 'modify', path: 'src/generated/workflow-runtime.ts', generatedMetadata: false, binary: false,
		additions: diff.filter((line) => line.kind === 'addition').length,
		deletions: diff.filter((line) => line.kind === 'deletion').length,
		diff
	};
}

export function buildReviewFixture(summary: SyncSummary, fixture: ReviewFixtureName = 'comprehensive'): ReviewProposal {
	if (fixture === 'error') {
		return {
			status: 'error', fixture, capturedHead: summary.head,
			title: 'Proposal could not be prepared',
			message: 'The fixture reconciler returned an invalid rename operation. No repository files were changed.',
			retryable: true
		};
	}
	const affected = fixture === 'large-diff' ? [largeOperation(), operations().at(-1)!] : operations();
	return {
		status: 'ready', id: `fixture-${fixture}-${summary.head.slice(0, 12)}`, fixture,
		capturedHead: summary.head,
		summary: fixture === 'large-diff'
			? 'Expand the generated workflow runtime while preserving its existing execution order.'
			: `Reconcile ${summary.changes.length} changed specification${summary.changes.length === 1 ? '' : 's'} with deadline-aware task scheduling.`,
		assumptions: [
			'Blocked tasks remain visible to callers but are not selected for execution.',
			'Deadlines use lexicographically sortable ISO-8601 values.'
		],
		warnings: [
			'The binary icon cannot be displayed as a text diff.',
			'Generated metadata is included in the proposal and collapsed by default.'
		],
		model: { provider: 'fixture', id: 'deterministic-review-v1' },
		usage: { tokens: { total: 2840, input: 2144, output: 696 }, estimatedCostUsd: 0.0128 },
		commitMessage: fixture === 'large-diff' ? 'Expand workflow runtime' : 'Reconcile deadline-aware task scheduling',
		operations: affected
	};
}
