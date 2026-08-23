export type RepositoryTreeNode = {
	name: string;
	path: string;
	type: 'directory' | 'file';
	children?: RepositoryTreeNode[];
};

export type Repository = {
	name: string;
	path: string;
	tree: RepositoryTreeNode[];
};

export type RepositoryState =
	| { status: 'empty' }
	| { status: 'missing'; path: string }
	| { status: 'ready'; repository: Repository };

export type FilePreview =
	| {
			kind: 'text';
			path: string;
			content: string;
			size: number;
			revision: string;
		}
	| {
			kind: 'unsupported';
			path: string;
			content: string | null;
			size: number;
			reason: string;
		};

export type SaveFileRequest = {
	repositoryPath: string;
	path: string;
	content: string;
	expectedRevision: string;
};

export type SaveFileResult =
	| { status: 'saved'; preview: Extract<FilePreview, { kind: 'text' }> }
	| { status: 'conflict'; disk: FilePreview | null };

export type CreateFileRequest = {
	repositoryPath: string;
	path: string;
};

export type RepositoryChange =
	| { repositoryPath: string; kind: 'tree'; tree: RepositoryTreeNode[] }
	| { repositoryPath: string; kind: 'file'; path: string; change: 'changed' | 'deleted' };

export type SpecificationChange =
	| { kind: 'added' | 'modified' | 'deleted'; path: string }
	| { kind: 'renamed'; path: string; oldPath: string };

export type HuzzahConfigState =
	| { status: 'loading' }
	| { status: 'missing' }
	| { status: 'invalid'; message: string }
	| { status: 'ready'; specDirectory: string; specifications: string[] };

export type GitState =
	| { status: 'loading' }
	| { status: 'ready'; head: string; changes: SpecificationChange[] }
	| { status: 'not-repository' }
	| { status: 'wrong-root'; repositoryRoot: string }
	| { status: 'missing-head' }
	| { status: 'unavailable' }
	| { status: 'error'; message: string };

export type HuzzahProjectState = {
	repositoryPath: string;
	config: HuzzahConfigState;
	git: GitState;
};

export type SyncSummary = {
	repositoryPath: string;
	head: string;
	changes: SpecificationChange[];
};

export const GENERATED_ARTIFACT_VERSION = 1 as const;
export const HIGHLIGHT_TAXONOMY_VERSION = 1 as const;

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

export type HighlightMark = {
	from: number;
	to: number;
	category: HighlightCategory;
	text: string;
};

export type SourcePosition = { line: number; column: number };
export type SourceRange = { from: SourcePosition; to: SourcePosition };

export type SourceMapping = {
	specification: SourceRange;
	source: SourceRange[];
};

export type GeneratedArtifact = {
	version: typeof GENERATED_ARTIFACT_VERSION;
	specification: { path: string; hash: string };
	highlighting?: {
		taxonomyVersion: typeof HIGHLIGHT_TAXONOMY_VERSION;
		marks: HighlightMark[];
	};
	sourceMaps: Array<{
		path: string;
		hash: string;
		mappings: SourceMapping[];
	}>;
};

export type MetadataStatus = 'current' | 'stale' | 'missing' | 'invalid';

export type GeneratedMetadataState = {
	specificationPath: string;
	artifactPath: string;
	artifactStatus: 'ready' | 'missing' | 'invalid';
	message?: string;
	highlighting: {
		status: MetadataStatus;
		marks?: HighlightMark[];
	};
	sourceMaps: Array<{
		path: string;
		status: Exclude<MetadataStatus, 'missing'> | 'missing';
		mappings?: SourceMapping[];
		message?: string;
	}>;
};

export type DesktopApi = Readonly<{
	platform: string;
	getRepositoryState: () => Promise<RepositoryState>;
	openRepository: () => Promise<RepositoryState | null>;
	closeRepository: () => Promise<void>;
	readFile: (path: string) => Promise<FilePreview>;
	createFile: (request: CreateFileRequest) => Promise<Extract<FilePreview, { kind: 'text' }>>;
	writeFile: (request: SaveFileRequest) => Promise<SaveFileResult>;
	onRepositoryChange: (listener: (change: RepositoryChange) => void) => () => void;
	getProjectState: () => Promise<HuzzahProjectState | null>;
	initializeProject: () => Promise<HuzzahProjectState>;
	refreshProjectState: () => Promise<HuzzahProjectState>;
	getSyncSummary: () => Promise<SyncSummary>;
	getGeneratedMetadata: (specificationPath: string) => Promise<GeneratedMetadataState>;
	onProjectStateChange: (listener: (state: HuzzahProjectState) => void) => () => void;
}>;
