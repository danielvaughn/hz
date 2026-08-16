<script lang="ts">
	import type { InferenceModel, InferenceUsage } from '$lib/inference';

	type Props = {
		summary: string;
		assumptions: string[];
		model?: InferenceModel | null;
		usage?: InferenceUsage | null;
	};

	let { summary, assumptions, model = null, usage = null }: Props = $props();

	function formatTokenCount(tokens: number) {
		return new Intl.NumberFormat().format(tokens);
	}

	function formatEstimatedCost(cost: number) {
		const fractionDigits = cost < 0.01 ? 4 : cost < 1 ? 3 : 2;
		return `$${cost.toFixed(fractionDigits)}`;
	}
</script>

<div class="proposal-review__copy">
	{#if model}
		<dl class="proposal-review__inference">
			<div>
				<dt class="proposal-review__label">Model</dt>
				<dd><code>{model.provider}/{model.id}</code></dd>
			</div>
			{#if usage}
				<div>
					<dt class="proposal-review__label">Tokens</dt>
					<dd>
						{formatTokenCount(usage.tokens.total)} ({formatTokenCount(usage.tokens.input)} input,
						{formatTokenCount(usage.tokens.output)} output)
					</dd>
				</div>
				<div title="Pi's model-pricing estimate; your provider's actual billing may differ.">
					<dt class="proposal-review__label">Est. cost</dt>
					<dd>{formatEstimatedCost(usage.estimatedCostUsd)} USD</dd>
				</div>
			{/if}
		</dl>
	{/if}
	<span class="proposal-review__label proposal-review__description-label">Description</span>
	<p>{summary}</p>
	{#if assumptions.length > 0}
		<div class="proposal-review__assumptions">
			<span class="proposal-review__label">Assumptions</span>
			<ol>
				{#each assumptions as assumption}
					<li>{assumption}</li>
				{/each}
			</ol>
		</div>
	{/if}
</div>
