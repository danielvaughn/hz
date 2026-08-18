import type { AgentSession } from '@earendil-works/pi-coding-agent';

import type { InferenceModel, InferenceUsage } from '$lib/inference';

export function inferenceDetails(session: AgentSession): {
	model: InferenceModel;
	usage: InferenceUsage;
} {
	if (!session.model) throw new Error('No inference model is available.');

	const stats = session.getSessionStats();
	return {
		model: { provider: session.model.provider, id: session.model.id },
		usage: {
			tokens: {
				total: stats.tokens.total,
				input: stats.tokens.input,
				output: stats.tokens.output
			},
			estimatedCostUsd: stats.cost
		}
	};
}
