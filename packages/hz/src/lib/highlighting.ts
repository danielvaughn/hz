import type { InferenceModel, InferenceUsage } from '$lib/inference';

export const HIGHLIGHT_TAXONOMY_VERSION = 1;

export const HIGHLIGHT_CATEGORIES = [
	'action',
	'object',
	'condition',
	'value',
	'identifier',
	'control',
	'operator',
	'type',
	'comment',
	'directive',
	'resource',
	'modifier'
] as const;

export type HighlightCategory = (typeof HIGHLIGHT_CATEGORIES)[number];

export type HighlightRange = {
	from: number;
	to: number;
};

export type HighlightMark = HighlightRange & {
	category: HighlightCategory;
	text: string;
};

export type PersistedHighlighting = {
	version: 1;
	taxonomyVersion: typeof HIGHLIGHT_TAXONOMY_VERSION;
	sourceText: string;
	marks: HighlightMark[];
	dirtyRanges: HighlightRange[];
};

export type HighlightResponse = {
	marks: HighlightMark[];
	model: InferenceModel;
	usage: InferenceUsage;
};

export function isHighlightCategory(value: unknown): value is HighlightCategory {
	return typeof value === 'string' && HIGHLIGHT_CATEGORIES.includes(value as HighlightCategory);
}

export function mergeHighlightRanges(ranges: HighlightRange[]): HighlightRange[] {
	const sorted = ranges
		.filter((range) => Number.isInteger(range.from) && Number.isInteger(range.to) && range.from <= range.to)
		.sort((left, right) => left.from - right.from || left.to - right.to);
	const merged: HighlightRange[] = [];

	for (const range of sorted) {
		const previous = merged.at(-1);
		if (previous && range.from <= previous.to) previous.to = Math.max(previous.to, range.to);
		else merged.push({ ...range });
	}

	return merged;
}

export function validHighlightMarks(text: string, marks: HighlightMark[]): HighlightMark[] {
	return marks.filter(
		(mark) =>
			Number.isInteger(mark.from) &&
			Number.isInteger(mark.to) &&
			mark.from >= 0 &&
			mark.from < mark.to &&
			mark.to <= text.length &&
			isHighlightCategory(mark.category) &&
			text.slice(mark.from, mark.to) === mark.text
	);
}
