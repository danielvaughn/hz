import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import type { HuzzahConfigState } from '../shared/desktop';

const CONFIG_PATH = '.huzzah/config.json';
const DEFAULT_SPEC_DIRECTORY = 'hz';

function portablePath(path: string): string {
	return path.split(sep).join('/');
}

function isInside(root: string, target: string): boolean {
	const path = relative(root, target);
	return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

async function findSpecifications(directory: string, specDirectory: string): Promise<string[]> {
	const paths: string[] = [];
	async function visit(current: string): Promise<void> {
		const entries = await readdir(current, { withFileTypes: true });
		await Promise.all(entries.map(async (entry) => {
			if (entry.isSymbolicLink()) return;
			const path = join(current, entry.name);
			if (entry.isDirectory()) await visit(path);
			else if (entry.isFile() && extname(entry.name).toLowerCase() === '.hz') {
				paths.push(`${specDirectory}/${portablePath(relative(directory, path))}`);
			}
		}));
	}
	await visit(directory);
	return paths.sort((left, right) => left.localeCompare(right));
}

export async function discoverHuzzahConfig(repositoryRoot: string): Promise<HuzzahConfigState> {
	let source: string;
	try {
		source = await readFile(join(repositoryRoot, CONFIG_PATH), 'utf8');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'missing' };
		return { status: 'invalid', message: 'The Huzzah configuration could not be read.' };
	}

	let value: unknown;
	try {
		value = JSON.parse(source);
	} catch {
		return { status: 'invalid', message: '.huzzah/config.json contains invalid JSON.' };
	}
	const specDirectoryValue = value && typeof value === 'object'
		? (value as { spec_directory?: unknown }).spec_directory
		: undefined;
	if (typeof specDirectoryValue !== 'string' || specDirectoryValue.trim() === '') {
		return { status: 'invalid', message: 'spec_directory must be a non-empty relative path.' };
	}
	if (isAbsolute(specDirectoryValue)) {
		return { status: 'invalid', message: 'spec_directory must be relative to the repository.' };
	}
	const target = resolve(repositoryRoot, specDirectoryValue);
	if (!isInside(repositoryRoot, target)) {
		return { status: 'invalid', message: 'spec_directory must resolve inside the repository.' };
	}
	const specDirectory = portablePath(relative(repositoryRoot, target));

	try {
		await lstat(target);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return { status: 'ready', specDirectory, specifications: [] };
		}
		return { status: 'invalid', message: 'The specification directory could not be inspected.' };
	}

	try {
		const canonicalTarget = await realpath(target);
		if (!isInside(repositoryRoot, canonicalTarget)) {
			return { status: 'invalid', message: 'spec_directory resolves outside the repository.' };
		}
		const canonicalInfo = await lstat(canonicalTarget);
		if (!canonicalInfo.isDirectory()) {
			return { status: 'invalid', message: 'spec_directory does not refer to a directory.' };
		}
		return {
			status: 'ready',
			specDirectory,
			specifications: await findSpecifications(canonicalTarget, specDirectory)
		};
	} catch (error) {
		return { status: 'invalid', message: 'The specification directory could not be inspected.' };
	}
}

export async function initializeHuzzahProject(repositoryRoot: string): Promise<void> {
	const configPath = join(repositoryRoot, CONFIG_PATH);
	await mkdir(join(repositoryRoot, DEFAULT_SPEC_DIRECTORY), { recursive: true });
	await mkdir(join(repositoryRoot, '.huzzah'), { recursive: true });
	try {
		await writeFile(
			configPath,
			`${JSON.stringify({ spec_directory: DEFAULT_SPEC_DIRECTORY }, null, 2)}\n`,
			{ encoding: 'utf8', flag: 'wx' }
		);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
			throw new Error('.huzzah/config.json already exists. Huzzah did not overwrite it.');
		}
		throw error;
	}
}
