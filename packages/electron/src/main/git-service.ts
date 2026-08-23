import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type GitFileChange =
	| { kind: 'added' | 'modified' | 'deleted'; path: string }
	| { kind: 'renamed'; path: string; oldPath: string };

export type GitRepositoryState =
	| { status: 'ready'; repositoryRoot: string; head: string; changes: GitFileChange[] }
	| { status: 'not-repository' }
	| { status: 'wrong-root'; repositoryRoot: string }
	| { status: 'missing-head'; repositoryRoot: string }
	| { status: 'unavailable' }
	| { status: 'error'; message: string };

type CommandFailure = Error & {
	code?: string | number;
	stderr?: string;
};

export class GitService {
	constructor(
		private readonly executable = 'git',
		private readonly timeoutMs = 10_000
	) {}

	async inspectRepository(repositoryPath: string): Promise<GitRepositoryState> {
		let root: string;
		try {
			root = (await this.run(repositoryPath, ['rev-parse', '--show-toplevel'])).trim();
		} catch (error) {
			return this.classifyRepositoryError(error);
		}

		if (resolve(root) !== resolve(repositoryPath)) {
			return { status: 'wrong-root', repositoryRoot: root };
		}

		let head: string;
		try {
			head = (await this.run(repositoryPath, ['rev-parse', '--verify', 'HEAD'])).trim();
		} catch (error) {
			if (this.isUnavailable(error)) return { status: 'unavailable' };
			return { status: 'missing-head', repositoryRoot: root };
		}

		try {
			const [trackedOutput, untrackedOutput] = await Promise.all([
				this.run(repositoryPath, [
					'diff',
					'--no-ext-diff',
					'--name-status',
					'-z',
					'--find-renames',
					'HEAD',
					'--'
				]),
				this.run(repositoryPath, ['ls-files', '--others', '--exclude-standard', '-z', '--'])
			]);
			const changes = this.mergeChanges(
				this.parseNameStatus(trackedOutput),
				this.parseUntracked(untrackedOutput)
			);
			return { status: 'ready', repositoryRoot: root, head, changes };
		} catch (error) {
			if (this.isUnavailable(error)) return { status: 'unavailable' };
			return { status: 'error', message: this.errorMessage(error) };
		}
	}

	private async run(repositoryPath: string, args: string[]): Promise<string> {
		const result = await execFileAsync(this.executable, ['-C', repositoryPath, ...args], {
			encoding: 'utf8',
			maxBuffer: 16 * 1024 * 1024,
			timeout: this.timeoutMs,
			windowsHide: true
		});
		return result.stdout;
	}

	private parseNameStatus(output: string): GitFileChange[] {
		const fields = output.split('\0');
		if (fields.at(-1) === '') fields.pop();
		const changes: GitFileChange[] = [];
		for (let index = 0; index < fields.length; ) {
			const status = fields[index++];
			if (!status) break;
			const code = status[0];
			if (code === 'R' || code === 'C') {
				const oldPath = fields[index++];
				const path = fields[index++];
				if (!oldPath || !path) throw new Error('Git returned an incomplete rename record.');
				changes.push(code === 'R' ? { kind: 'renamed', oldPath, path } : { kind: 'added', path });
				continue;
			}
			const path = fields[index++];
			if (!path) throw new Error('Git returned an incomplete file status record.');
			if (code === 'A') changes.push({ kind: 'added', path });
			else if (code === 'D') changes.push({ kind: 'deleted', path });
			else changes.push({ kind: 'modified', path });
		}
		return changes;
	}

	private parseUntracked(output: string): GitFileChange[] {
		return output.split('\0').filter(Boolean).map((path) => ({ kind: 'added' as const, path }));
	}

	private mergeChanges(tracked: GitFileChange[], untracked: GitFileChange[]): GitFileChange[] {
		const trackedPaths = new Set(
			tracked.flatMap((change) => change.kind === 'renamed' ? [change.oldPath, change.path] : [change.path])
		);
		return [...tracked, ...untracked.filter((change) => !trackedPaths.has(change.path))];
	}

	private classifyRepositoryError(error: unknown): GitRepositoryState {
		if (this.isUnavailable(error)) return { status: 'unavailable' };
		const failure = error as CommandFailure;
		if (failure.stderr?.toLowerCase().includes('not a git repository')) {
			return { status: 'not-repository' };
		}
		return { status: 'error', message: this.errorMessage(error) };
	}

	private isUnavailable(error: unknown): boolean {
		return (error as CommandFailure).code === 'ENOENT';
	}

	private errorMessage(error: unknown): string {
		const failure = error as CommandFailure;
		const stderr = failure.stderr?.trim();
		if (stderr) return stderr.replace(/^fatal:\s*/i, '');
		return error instanceof Error ? error.message : 'Git status could not be read.';
	}
}
