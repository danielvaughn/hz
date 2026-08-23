import assert from 'node:assert/strict';
import test from 'node:test';

import {
	InvalidHighlightResponseError,
	parseHighlightResponse
} from '../src/main/highlighting-service.ts';

test('turns exact model segments into UTF-16 highlight offsets', () => {
	const text = 'Create a café ☕';
	const marks = parseHighlightResponse(JSON.stringify({ segments: [
		{ text: 'Create', category: 'action' },
		{ text: ' a ', category: null },
		{ text: 'café ☕', category: 'object' }
	] }), text);
	assert.deepEqual(marks, [
		{ from: 0, to: 6, category: 'action', text: 'Create' },
		{ from: 9, to: text.length, category: 'object', text: 'café ☕' }
	]);
});

test('accepts a single JSON fence but rejects rewritten source', () => {
	assert.deepEqual(parseHighlightResponse('```json\n{"segments":[{"text":"ok","category":"value"}]}\n```', 'ok'), [
		{ from: 0, to: 2, category: 'value', text: 'ok' }
	]);
	assert.throws(
		() => parseHighlightResponse('{"segments":[{"text":"changed","category":null}]}', 'source'),
		InvalidHighlightResponseError
	);
});

test('rejects unknown categories and malformed payloads', () => {
	assert.throws(() => parseHighlightResponse('{"segments":[{"text":"x","category":"rainbow"}]}', 'x'), InvalidHighlightResponseError);
	assert.throws(() => parseHighlightResponse('not json', 'x'), InvalidHighlightResponseError);
});
