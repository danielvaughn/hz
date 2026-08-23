import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type {
	GitState,
	HuzzahConfigState,
	HuzzahProjectState,
	GeneratedMetadataState,
	RegenerateHighlightingResult,
	ReviewFixtureName,
	ReviewProposal,
	SpecificationChange,
	SyncSummary
} from '../shared/desktop';
import { GitService, type GitFileChange, type GitRepositoryState } from './git-service';
import { discoverHuzzahConfig, initializeHuzzahProject } from './huzzah-config';
import { loadGeneratedMetadata, persistGeneratedHighlighting } from './generated-metadata';
import { HighlightingService } from './highlighting-service';
import { buildReviewFixture } from './review-fixtures';

export class ProjectService {
	private repositoryPath: string | null = null;
	private state: HuzzahProjectState | null = null;
	private generation = 0;
	private refreshTimer: NodeJS.Timeout | null = null;

	constructor(
		private readonly onChange: (state: HuzzahProjectState) => void = () => {},
		private readonly git = new GitService(),
		private readonly highlighting = new HighlightingService()
	) {}

	open(repositoryPath: string): void {
		this.close();
		this.repositoryPath = repositoryPath;
		this.state = {
			repositoryPath,
			config: { status: 'loading' },
			git: { status: 'loading' }
		};
		this.onChange(this.state);
		void this.refresh();
	}

	close(): void {
		this.generation += 1;
		if (this.refreshTimer) clearTimeout(this.refreshTimer);
		this.refreshTimer = null;
		this.repositoryPath = null;
		this.state = null;
	}

	getState(): HuzzahProjectState | null {
		return this.state;
	}

	scheduleRefresh(delayMs = 250): void {
		if (!this.repositoryPath) return;
		if (this.refreshTimer) clearTimeout(this.refreshTimer);
		this.refreshTimer = setTimeout(() => {
			this.refreshTimer = null;
			void this.refresh();
		}, delayMs);
	}

	async refresh(): Promise<HuzzahProjectState> {
		const repositoryPath = this.requireRepository();
		const generation = ++this.generation;
		const [config, repositoryGit] = await Promise.all([
			discoverHuzzahConfig(repositoryPath),
			this.git.inspectRepository(repositoryPath)
		]);
		const nextState: HuzzahProjectState = {
			repositoryPath,
			config,
			git: this.projectGitState(repositoryGit, config)
		};
		if (generation === this.generation && repositoryPath === this.repositoryPath) {
			this.state = nextState;
			this.onChange(nextState);
		}
		return nextState;
	}

	async initialize(): Promise<HuzzahProjectState> {
		const repositoryPath = this.requireRepository();
		const config = await discoverHuzzahConfig(repositoryPath);
		if (config.status !== 'missing') {
			throw new Error(config.status === 'invalid'
				? 'Fix the existing .huzzah/config.json before initializing.'
				: config.status === 'ready'
					? 'This repository is already initialized for Huzzah.'
					: 'Wait for Huzzah project discovery to finish.');
		}
		await initializeHuzzahProject(repositoryPath);
		return this.refresh();
	}

	async getSyncSummary(): Promise<SyncSummary> {
		const state = await this.refresh();
		if (state.config.status !== 'ready') {
			throw new Error('A valid Huzzah configuration is required before synchronization.');
		}
		if (state.git.status !== 'ready') {
			throw new Error('Git status must be available before synchronization.');
		}
		if (state.git.changes.length === 0) {
			throw new Error('No changed specifications were found.');
		}
		return {
			repositoryPath: state.repositoryPath,
			head: state.git.head,
			changes: state.git.changes
		};
	}

	async getReviewFixture(fixture: ReviewFixtureName = 'comprehensive'): Promise<ReviewProposal> {
		return buildReviewFixture(await this.getSyncSummary(), fixture);
	}

	async getGeneratedMetadata(specificationPath: string): Promise<GeneratedMetadataState> {
		const repositoryPath = this.requireRepository();
		const state = this.state?.config.status === 'ready' ? this.state : await this.refresh();
		if (state.config.status !== 'ready' || !state.config.specifications.includes(specificationPath)) {
			throw new Error('Generated metadata is available only for configured specification files.');
		}
		return loadGeneratedMetadata(repositoryPath, specificationPath);
	}

	async regenerateHighlighting(specificationPath: string): Promise<RegenerateHighlightingResult> {
		const repositoryPath = this.requireRepository();
		const state = await this.refresh();
		if (state.config.status !== 'ready' || !state.config.specifications.includes(specificationPath)) {
			throw new Error('Highlighting can be generated only for configured specification files.');
		}
		const specification = await readFile(resolve(repositoryPath, specificationPath), 'utf8');
		const generated = await this.highlighting.generate(specification);
		const metadata = await persistGeneratedHighlighting(repositoryPath, specificationPath, generated.marks);
		this.scheduleRefresh(0);
		return { metadata, model: generated.model, usage: generated.usage };
	}

	private requireRepository(): string {
		if (!this.repositoryPath) throw new Error('Open a repository first.');
		return this.repositoryPath;
	}

	private projectGitState(git: GitRepositoryState, config: HuzzahConfigState): GitState {
		if (git.status !== 'ready') return git;
		const changes = config.status === 'ready'
			? git.changes.flatMap((change) => this.specificationChange(change, config.specDirectory))
			: [];
		return { status: 'ready', head: git.head, changes };
	}

	private specificationChange(change: GitFileChange, specDirectory: string): SpecificationChange[] {
		const isSpecification = (path: string) =>
			path.startsWith(`${specDirectory}/`) && path.toLowerCase().endsWith('.hz');
		if (change.kind !== 'renamed') {
			return isSpecification(change.path) ? [change] : [];
		}
		const oldIsSpecification = isSpecification(change.oldPath);
		const newIsSpecification = isSpecification(change.path);
		if (oldIsSpecification && newIsSpecification) return [change];
		if (oldIsSpecification) return [{ kind: 'deleted', path: change.oldPath }];
		if (newIsSpecification) return [{ kind: 'added', path: change.path }];
		return [];
	}
}
