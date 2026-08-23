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

export type RepositoryChange =
	| { repositoryPath: string; kind: 'tree'; tree: RepositoryTreeNode[] }
	| { repositoryPath: string; kind: 'file'; path: string; change: 'changed' | 'deleted' };

export type DesktopApi = Readonly<{
	platform: string;
	getRepositoryState: () => Promise<RepositoryState>;
	openRepository: () => Promise<RepositoryState | null>;
	closeRepository: () => Promise<void>;
	readFile: (path: string) => Promise<FilePreview>;
	writeFile: (request: SaveFileRequest) => Promise<SaveFileResult>;
	onRepositoryChange: (listener: (change: RepositoryChange) => void) => () => void;
}>;
