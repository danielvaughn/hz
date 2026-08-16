export type InferenceModel = {
	provider: string;
	id: string;
};

export type InferenceUsage = {
	tokens: {
		total: number;
		input: number;
		output: number;
	};
	estimatedCostUsd: number;
};
