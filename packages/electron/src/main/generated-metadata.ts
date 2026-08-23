import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import {
	GENERATED_ARTIFACT_VERSION,
	HIGHLIGHT_CATEGORIES,
	HIGHLIGHT_TAXONOMY_VERSION,
	type GeneratedMetadataState,
	type HighlightMark,
	type SourceMapping,
	type SourcePosition,
	type SourceRange
} from '../shared/desktop.ts';

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function portablePath(path: string): string {
	return path.split(sep).join('/');
}

function pathError(path: string): string | null {
	if (!path || isAbsolute(path) || path.includes('\\')) return 'Path must be repository-relative and use forward slashes.';
	const parts = path.split('/');
	if (parts.some((part) => !part || part === '.' || part === '..')) return 'Path contains an unsafe segment.';
	return null;
}

function repositoryPath(root: string, path: string): string | null {
	if (pathError(path)) return null;
	const target = resolve(root, path);
	const fromRoot = relative(root, target);
	if (fromRoot === '' || fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) return null;
	return target;
}

export function normalizeGeneratedText(text: string): string {
	return text.replace(/\r\n?/g, '\n');
}

export function hashGeneratedText(text: string): string {
	return createHash('sha256').update(normalizeGeneratedText(text), 'utf8').digest('hex');
}

export function generatedArtifactPath(specificationPath: string): string {
	if (pathError(specificationPath) || !specificationPath.toLowerCase().endsWith('.hz')) {
		throw new Error('Specification paths must be safe repository-relative .hz paths.');
	}
	return `.huzzah/generated/${specificationPath}.json`;
}

function isHash(value: unknown): value is string {
	return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function lines(text: string): string[] {
	return normalizeGeneratedText(text).split('\n');
}

function validPosition(value: unknown, contentLines: string[]): value is SourcePosition {
	if (!isRecord(value) || !Number.isInteger(value.line) || !Number.isInteger(value.column)) return false;
	const line = value.line as number;
	const column = value.column as number;
	return line >= 1 && line <= contentLines.length && column >= 0 && column <= (contentLines[line - 1]?.length ?? 0);
}

function comparePositions(left: SourcePosition, right: SourcePosition): number {
	return left.line - right.line || left.column - right.column;
}

function validRange(value: unknown, contentLines: string[]): value is SourceRange {
	return isRecord(value) && validPosition(value.from, contentLines) && validPosition(value.to, contentLines) &&
		comparePositions(value.from, value.to) <= 0;
}

function rangeShape(value: unknown): value is SourceRange {
	if (!isRecord(value) || !isRecord(value.from) || !isRecord(value.to)) return false;
	const positions = [value.from, value.to];
	if (!positions.every((position) => Number.isInteger(position.line) && (position.line as number) >= 1 &&
		Number.isInteger(position.column) && (position.column as number) >= 0)) return false;
	return comparePositions(value.from as SourcePosition, value.to as SourcePosition) <= 0;
}

function validHighlightingShape(value: unknown): value is { taxonomyVersion: 1; marks: HighlightMark[] } {
	if (!isRecord(value) || value.taxonomyVersion !== HIGHLIGHT_TAXONOMY_VERSION || !Array.isArray(value.marks)) return false;
	return value.marks.every((mark) => isRecord(mark) && Number.isInteger(mark.from) && Number.isInteger(mark.to) &&
		(mark.from as number) >= 0 && (mark.from as number) < (mark.to as number) &&
		typeof mark.category === 'string' && HIGHLIGHT_CATEGORIES.includes(mark.category as HighlightMark['category']) &&
		typeof mark.text === 'string');
}

function validHighlighting(value: unknown, specificationText: string): value is { taxonomyVersion: 1; marks: HighlightMark[] } {
	if (!validHighlightingShape(value)) return false;
	return value.marks.every((mark) => {
		const from = mark.from as number;
		const to = mark.to as number;
		return to <= specificationText.length && specificationText.slice(from, to) === mark.text;
	});
}

export function validHighlightMarks(specificationText: string, marks: HighlightMark[]): HighlightMark[] {
	return marks.filter((mark) => validHighlighting(
		{ taxonomyVersion: HIGHLIGHT_TAXONOMY_VERSION, marks: [mark] },
		specificationText
	));
}

function validMappingsShape(value: unknown): value is SourceMapping[] {
	return Array.isArray(value) && value.every((mapping) => isRecord(mapping) && rangeShape(mapping.specification) &&
		Array.isArray(mapping.source) && mapping.source.length > 0 && mapping.source.every(rangeShape));
}

function validMappings(value: unknown, specificationText: string, sourceText: string): value is SourceMapping[] {
	if (!Array.isArray(value)) return false;
	const specificationLines = lines(specificationText);
	const sourceLines = lines(sourceText);
	return value.every((mapping) => isRecord(mapping) &&
		validRange(mapping.specification, specificationLines) &&
		Array.isArray(mapping.source) && mapping.source.length > 0 &&
		mapping.source.every((range) => validRange(range, sourceLines)));
}

function unavailableState(specificationPath: string, artifactPath: string, status: 'missing' | 'invalid', message?: string): GeneratedMetadataState {
	return {
		specificationPath,
		artifactPath,
		artifactStatus: status,
		...(message ? { message } : {}),
		highlighting: { status },
		sourceMaps: []
	};
}

async function readRepositoryText(repositoryRoot: string, path: string): Promise<{ status: 'ready'; text: string } | { status: 'missing' | 'invalid'; message: string }> {
	const target = repositoryPath(repositoryRoot, path);
	if (!target) return { status: 'invalid', message: 'Path resolves outside the repository.' };
	try {
		const info = await lstat(target);
		if (info.isSymbolicLink() || !info.isFile()) return { status: 'invalid', message: 'Path is not a regular repository file.' };
		const canonicalRoot = await realpath(repositoryRoot);
		const canonicalTarget = await realpath(target);
		const fromRoot = relative(canonicalRoot, canonicalTarget);
		if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
			return { status: 'invalid', message: 'Path resolves outside the repository.' };
		}
		const bytes = await readFile(canonicalTarget);
		return { status: 'ready', text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'missing', message: 'File does not exist.' };
		return { status: 'invalid', message: 'File could not be read as UTF-8 text.' };
	}
}

async function ensureRepositoryDirectory(repositoryRoot: string, path: string): Promise<string> {
	const canonicalRoot = await realpath(repositoryRoot);
	let directory = canonicalRoot;
	for (const part of portablePath(path).split('/')) {
		const next = resolve(directory, part);
		try { await mkdir(next); } catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
		}
		const info = await lstat(next);
		if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('The generated artifact directory is unsafe.');
		const canonicalNext = await realpath(next);
		const fromRoot = relative(canonicalRoot, canonicalNext);
		if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
			throw new Error('The generated artifact directory resolves outside the repository.');
		}
		directory = canonicalNext;
	}
	return directory;
}

export async function loadGeneratedMetadata(repositoryRoot: string, specificationPath: string): Promise<GeneratedMetadataState> {
	const artifactPath = generatedArtifactPath(specificationPath);
	const specification = await readRepositoryText(repositoryRoot, specificationPath);
	if (specification.status !== 'ready') {
		return unavailableState(specificationPath, artifactPath, 'invalid', 'The specification could not be read safely.');
	}

	let source: string;
	const artifactFile = await readRepositoryText(repositoryRoot, artifactPath);
	if (artifactFile.status === 'missing') return unavailableState(specificationPath, artifactPath, 'missing');
	if (artifactFile.status !== 'ready') return unavailableState(specificationPath, artifactPath, 'invalid', 'The generated artifact could not be read safely.');
	source = artifactFile.text;

	let value: unknown;
	try {
		value = JSON.parse(source);
	} catch {
		return unavailableState(specificationPath, artifactPath, 'invalid', 'The generated artifact contains invalid JSON.');
	}
	if (!isRecord(value)) return unavailableState(specificationPath, artifactPath, 'invalid', 'The generated artifact must be an object.');
	if (value.version !== GENERATED_ARTIFACT_VERSION) {
		return unavailableState(specificationPath, artifactPath, 'invalid', `Unsupported generated artifact version: ${String(value.version)}.`);
	}
	if (!isRecord(value.specification) || value.specification.path !== specificationPath || !isHash(value.specification.hash)) {
		return unavailableState(specificationPath, artifactPath, 'invalid', 'The artifact specification identity is invalid.');
	}
	if (!Array.isArray(value.sourceMaps)) {
		return unavailableState(specificationPath, artifactPath, 'invalid', 'The artifact sourceMaps field must be an array.');
	}

	const specificationCurrent = hashGeneratedText(specification.text) === value.specification.hash;
	let highlighting: GeneratedMetadataState['highlighting'];
	if (value.highlighting === undefined) highlighting = { status: 'missing' };
	else if (!validHighlightingShape(value.highlighting)) highlighting = { status: 'invalid' };
	else if (!specificationCurrent) highlighting = { status: 'stale' };
	else if (!validHighlighting(value.highlighting, specification.text)) highlighting = { status: 'invalid' };
	else highlighting = { status: 'current', marks: value.highlighting.marks };

	const seenPaths = new Set<string>();
	const sourceMaps: GeneratedMetadataState['sourceMaps'] = [];
	for (const [index, entry] of value.sourceMaps.entries()) {
		if (!isRecord(entry) || typeof entry.path !== 'string') {
			sourceMaps.push({ path: `<entry ${index + 1}>`, status: 'invalid', message: 'Source-map entry must include a path.' });
			continue;
		}
		const path = entry.path;
		if (pathError(path) || path.startsWith('.git/') || path.startsWith('.huzzah/generated/') || seenPaths.has(path) ||
			!isHash(entry.hash) || (entry.specificationHash !== undefined && !isHash(entry.specificationHash))) {
			sourceMaps.push({ path, status: 'invalid', message: 'Source-map identity is unsafe or invalid.' });
			continue;
		}
		seenPaths.add(path);
		if (!validMappingsShape(entry.mappings)) {
			sourceMaps.push({ path, status: 'invalid', message: 'Source-map ranges are malformed.' });
			continue;
		}
		const target = await readRepositoryText(repositoryRoot, path);
		if (target.status !== 'ready') {
			sourceMaps.push({ path, status: target.status, message: target.message });
			continue;
		}
		const mappingSpecificationHash = typeof entry.specificationHash === 'string'
			? entry.specificationHash
			: value.specification.hash;
		const current = hashGeneratedText(specification.text) === mappingSpecificationHash && hashGeneratedText(target.text) === entry.hash;
		if (!current) {
			sourceMaps.push({ path, status: 'stale' });
			continue;
		}
		if (!validMappings(entry.mappings, specification.text, target.text)) {
			sourceMaps.push({ path, status: 'invalid', message: 'Source-map ranges are invalid for the current files.' });
			continue;
		}
		sourceMaps.push({ path, status: 'current', mappings: entry.mappings });
	}

	return { specificationPath, artifactPath, artifactStatus: 'ready', highlighting, sourceMaps };
}

export async function persistGeneratedHighlighting(
	repositoryRoot: string,
	specificationPath: string,
	marks: HighlightMark[]
): Promise<GeneratedMetadataState> {
	const artifactPath = generatedArtifactPath(specificationPath);
	const specification = await readRepositoryText(repositoryRoot, specificationPath);
	if (specification.status !== 'ready') throw new Error('The specification could not be read safely.');
	if (validHighlightMarks(specification.text, marks).length !== marks.length) {
		throw new Error('Generated highlighting does not match the current specification.');
	}

	let sourceMaps: unknown[] = [];
	const existing = await readRepositoryText(repositoryRoot, artifactPath);
	if (existing.status === 'ready') {
		let artifact: unknown;
		try { artifact = JSON.parse(existing.text); } catch { throw new Error('The existing generated artifact contains invalid JSON.'); }
		if (!isRecord(artifact) || artifact.version !== GENERATED_ARTIFACT_VERSION ||
			!isRecord(artifact.specification) || artifact.specification.path !== specificationPath ||
			!isHash(artifact.specification.hash) || !Array.isArray(artifact.sourceMaps)) {
			throw new Error('The existing generated artifact is invalid and cannot be updated safely.');
		}
		const previousSpecificationHash = artifact.specification.hash;
		sourceMaps = artifact.sourceMaps.map((entry) => isRecord(entry) && entry.specificationHash === undefined
			? { ...entry, specificationHash: previousSpecificationHash }
			: entry);
	} else if (existing.status === 'invalid') {
		throw new Error('The existing generated artifact could not be read safely.');
	}

	const artifact = {
		version: GENERATED_ARTIFACT_VERSION,
		specification: { path: specificationPath, hash: hashGeneratedText(specification.text) },
		highlighting: { taxonomyVersion: HIGHLIGHT_TAXONOMY_VERSION, marks },
		sourceMaps
	};
	const lexicalTarget = repositoryPath(repositoryRoot, artifactPath);
	if (!lexicalTarget) throw new Error('The generated artifact path is unsafe.');
	const parent = await ensureRepositoryDirectory(repositoryRoot, relative(repositoryRoot, dirname(lexicalTarget)));
	const target = resolve(parent, basename(lexicalTarget));
	const temporary = `${target}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporary, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
		await rename(temporary, target);
	} catch (error) {
		try { await unlink(temporary); } catch { /* best effort */ }
		throw error;
	}
	return loadGeneratedMetadata(repositoryRoot, specificationPath);
}
