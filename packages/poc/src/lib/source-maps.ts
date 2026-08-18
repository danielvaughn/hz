export type SourceMapPosition = {
	line: number;
	column: number;
};

export type SourceMapRange = {
	from: SourceMapPosition;
	to: SourceMapPosition;
};

export type IntentSourceMapping = {
	intent: SourceMapRange;
	generated: SourceMapRange[];
};

export type IntentSourceMap = {
	version: 1;
	mappings: IntentSourceMapping[];
};

export type IntentSourceMapValidation =
	| { sourceMap: IntentSourceMap; errors: [] }
	| { sourceMap: null; errors: string[] };

export type NormalizedIntentSourceMap = {
	sourceMap: IntentSourceMap;
	warnings: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validPosition(value: unknown, lines: string[]): value is SourceMapPosition {
	if (!isRecord(value) || !Number.isInteger(value.line) || !Number.isInteger(value.column)) {
		return false;
	}

	const line = value.line as number;
	const column = value.column as number;
	return line >= 1 && line <= lines.length && column >= 0 && column <= (lines[line - 1]?.length ?? 0);
}

function comparePositions(left: SourceMapPosition, right: SourceMapPosition) {
	return left.line - right.line || left.column - right.column;
}

function validRange(value: unknown, lines: string[]): value is SourceMapRange {
	return (
		isRecord(value) &&
		validPosition(value.from, lines) &&
		validPosition(value.to, lines) &&
		comparePositions(value.from, value.to) <= 0
	);
}

function positionErrors(value: unknown, lines: string[], path: string) {
	const errors: string[] = [];
	if (!isRecord(value)) return [`${path} must be an object.`];
	if (!Number.isInteger(value.line)) errors.push(`${path}.line must be an integer.`);
	if (!Number.isInteger(value.column)) errors.push(`${path}.column must be an integer.`);
	if (errors.length > 0) return errors;

	const line = value.line as number;
	const column = value.column as number;
	if (line < 1 || line > lines.length) {
		errors.push(`${path}.line ${line} is outside the valid range 1-${lines.length}.`);
		return errors;
	}

	const maximumColumn = lines[line - 1]?.length ?? 0;
	if (column < 0 || column > maximumColumn) {
		errors.push(
			`${path}.column ${column} is outside the valid range 0-${maximumColumn} for line ${line}.`
		);
	}
	return errors;
}

function rangeErrors(value: unknown, lines: string[], path: string) {
	if (!isRecord(value)) return [`${path} must be an object.`];
	const errors = [
		...positionErrors(value.from, lines, `${path}.from`),
		...positionErrors(value.to, lines, `${path}.to`)
	];
	if (
		errors.length === 0 &&
		validPosition(value.from, lines) &&
		validPosition(value.to, lines) &&
		comparePositions(value.from, value.to) > 0
	) {
		errors.push(`${path}.to must not come before ${path}.from.`);
	}
	return errors;
}

export function validateIntentSourceMap(
	value: unknown,
	intentText: string,
	generatedText: string
): IntentSourceMapValidation {
	if (!Array.isArray(value)) {
		return { sourceMap: null, errors: ['sourceMap must be an array.'] };
	}

	const intentLines = intentText.split('\n');
	const generatedLines = generatedText.split('\n');
	const mappings: IntentSourceMapping[] = [];
	const errors: string[] = [];

	value.forEach((entry, mappingIndex) => {
		const path = `sourceMap[${mappingIndex}]`;
		if (!isRecord(entry)) {
			errors.push(`${path} must be an object.`);
			return;
		}

		errors.push(...rangeErrors(entry.intent, intentLines, `${path}.intent`));
		if (!Array.isArray(entry.generated)) {
			errors.push(`${path}.generated must be an array.`);
		} else if (entry.generated.length === 0) {
			errors.push(`${path}.generated must contain at least one range.`);
		} else {
			entry.generated.forEach((range, rangeIndex) => {
				errors.push(...rangeErrors(range, generatedLines, `${path}.generated[${rangeIndex}]`));
			});
		}

		if (
			validRange(entry.intent, intentLines) &&
			Array.isArray(entry.generated) &&
			entry.generated.length > 0 &&
			entry.generated.every((range) => validRange(range, generatedLines))
		) {
			mappings.push({ intent: entry.intent, generated: entry.generated });
		}
	});

	if (errors.length > 0) return { sourceMap: null, errors };
	return { sourceMap: { version: 1, mappings }, errors: [] };
}

export function parseIntentSourceMap(
	value: unknown,
	intentText: string,
	generatedText: string
): IntentSourceMap | null {
	return validateIntentSourceMap(value, intentText, generatedText).sourceMap;
}

export function normalizeModelSourceMap(
	value: unknown,
	intentText: string,
	generatedText: string
): NormalizedIntentSourceMap {
	const warnings: string[] = [];
	const mappings: IntentSourceMapping[] = [];
	const intentLines = intentText.split('\n');
	const generatedLines = generatedText.split('\n');

	if (!Array.isArray(value)) {
		return {
			sourceMap: { version: 1, mappings },
			warnings: ['sourceMap was not an array; continuing without source-map highlighting.']
		};
	}

	value.forEach((entry, mappingIndex) => {
		const path = `sourceMap[${mappingIndex}]`;
		if (!isRecord(entry) || !Number.isInteger(entry.intentLine)) {
			warnings.push(`${path} was dropped because intentLine is not an integer.`);
			return;
		}

		const intentLine = entry.intentLine as number;
		if (intentLine < 1 || intentLine > intentLines.length) {
			warnings.push(
				`${path} was dropped because intentLine ${intentLine} is outside 1-${intentLines.length}.`
			);
			return;
		}

		if (!Array.isArray(entry.generated) || entry.generated.length === 0) {
			warnings.push(`${path} was dropped because generated has no line ranges.`);
			return;
		}

		const generated: SourceMapRange[] = [];
		entry.generated.forEach((range, rangeIndex) => {
			const rangePath = `${path}.generated[${rangeIndex}]`;
			if (
				!isRecord(range) ||
				!Number.isInteger(range.fromLine) ||
				!Number.isInteger(range.toLine)
			) {
				warnings.push(`${rangePath} was dropped because fromLine and toLine must be integers.`);
				return;
			}

			const requestedFrom = range.fromLine as number;
			const requestedTo = range.toLine as number;
			const lower = Math.min(requestedFrom, requestedTo);
			const upper = Math.max(requestedFrom, requestedTo);
			const fromLine = Math.max(1, Math.min(lower, generatedLines.length));
			const toLine = Math.max(1, Math.min(upper, generatedLines.length));

			if (fromLine !== requestedFrom || toLine !== requestedTo) {
				warnings.push(
					`${rangePath} was normalized from ${requestedFrom}-${requestedTo} to ${fromLine}-${toLine}.`
				);
			}

			generated.push({
				from: { line: fromLine, column: 0 },
				to: { line: toLine, column: generatedLines[toLine - 1]?.length ?? 0 }
			});
		});

		if (generated.length === 0) {
			warnings.push(`${path} was dropped because none of its generated ranges were usable.`);
			return;
		}

		mappings.push({
			intent: {
				from: { line: intentLine, column: 0 },
				to: { line: intentLine, column: intentLines[intentLine - 1]?.length ?? 0 }
			},
			generated
		});
	});

	return { sourceMap: { version: 1, mappings }, warnings };
}

export function cloneIntentSourceMap(sourceMap: IntentSourceMap | null) {
	if (!sourceMap) return null;
	return {
		version: 1 as const,
		mappings: sourceMap.mappings.map((mapping) => ({
			intent: {
				from: { ...mapping.intent.from },
				to: { ...mapping.intent.to }
			},
			generated: mapping.generated.map((range) => ({
				from: { ...range.from },
				to: { ...range.to }
			}))
		}))
	};
}

export function generatedRangesForIntentLine(sourceMap: IntentSourceMap | null, line: number) {
	if (!sourceMap) return [];

	return sourceMap.mappings.flatMap((mapping) => {
		const startsBeforeLine = mapping.intent.from.line <= line;
		const lastLine =
			mapping.intent.to.column === 0 && mapping.intent.to.line > mapping.intent.from.line
				? mapping.intent.to.line - 1
				: mapping.intent.to.line;
		const endsAfterLine = lastLine >= line;
		return startsBeforeLine && endsAfterLine ? mapping.generated : [];
	});
}

export function coversEveryIntentLine(sourceMap: IntentSourceMap, intentText: string) {
	return uncoveredIntentLines(sourceMap, intentText).length === 0;
}

export function uncoveredIntentLines(sourceMap: IntentSourceMap, intentText: string) {
	return intentText.split('\n').flatMap((text, index) => {
		if (text.trim().length === 0) return [];
		const line = index + 1;
		const covered = sourceMap.mappings.some((mapping) => {
			const lastLine =
				mapping.intent.to.column === 0 && mapping.intent.to.line > mapping.intent.from.line
					? mapping.intent.to.line - 1
					: mapping.intent.to.line;
			return mapping.intent.from.line <= line && lastLine >= line;
		});
		return covered ? [] : [line];
	});
}
