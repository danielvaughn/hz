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
		}
	| {
			kind: 'unsupported';
			path: string;
			content: string | null;
			size: number;
			reason: string;
		};

export type DesktopApi = Readonly<{
	platform: string;
	getRepositoryState: () => Promise<RepositoryState>;
	openRepository: () => Promise<RepositoryState | null>;
	closeRepository: () => Promise<void>;
	readFile: (path: string) => Promise<FilePreview>;
}>;
