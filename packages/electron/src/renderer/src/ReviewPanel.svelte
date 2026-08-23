<script lang="ts">
	import { onDestroy } from 'svelte';
	import type {
		ProposalFileOperation,
		ReviewFixtureName,
		ReviewProposal
	} from '../../shared/desktop';

	let { proposal, loading = false, onReject, onFixtureChange }: {
		proposal: ReviewProposal;
		loading?: boolean;
		onReject: () => void;
		onFixtureChange: (fixture: ReviewFixtureName) => void;
	} = $props();

	let selectedId = $state('');
	let width = $state(650);
	let commitMessage = $state('');
	let dragging = $state(false);
	let initializedProposalId = $state('');

	let readyProposal = $derived(proposal.status === 'ready' ? proposal : null);
	let selected = $derived(readyProposal?.operations.find((file) => file.id === selectedId) ?? readyProposal?.operations[0] ?? null);
	let sourceFiles = $derived(readyProposal?.operations.filter((file) => !file.generatedMetadata) ?? []);
	let metadataFiles = $derived(readyProposal?.operations.filter((file) => file.generatedMetadata) ?? []);
	let additions = $derived(readyProposal?.operations.reduce((sum, file) => sum + file.additions, 0) ?? 0);
	let deletions = $derived(readyProposal?.operations.reduce((sum, file) => sum + file.deletions, 0) ?? 0);

	$effect(() => {
		if (!readyProposal || readyProposal.id === initializedProposalId) return;
		initializedProposalId = readyProposal.id;
		selectedId = sourceFiles[0]?.id ?? readyProposal.operations[0]?.id ?? '';
		commitMessage = readyProposal.commitMessage;
	});

	function label(file: ProposalFileOperation): string {
		return file.kind.toUpperCase();
	}

	function beginResize(event: PointerEvent): void {
		event.preventDefault();
		dragging = true;
		document.body.classList.add('review-resizing');
		window.addEventListener('pointermove', resize);
		window.addEventListener('pointerup', finishResize, { once: true });
	}

	function resize(event: PointerEvent): void {
		width = Math.max(390, Math.min(820, window.innerWidth - event.clientX));
	}

	function finishResize(): void {
		dragging = false;
		document.body.classList.remove('review-resizing');
		window.removeEventListener('pointermove', resize);
	}

	function navigateDiff(event: KeyboardEvent & { currentTarget: HTMLDivElement }): void {
		if (event.key === 'Home') event.currentTarget.scrollTo({ top: 0 });
		if (event.key === 'End') event.currentTarget.scrollTo({ top: event.currentTarget.scrollHeight });
	}

	onDestroy(() => {
		finishResize();
	});
</script>

<aside class:dragging class="review-panel" style={`width: ${width}px`} aria-label="Reconciliation proposal review">
	<button class="review-resize" aria-label="Resize review panel" title="Drag to resize" onpointerdown={beginResize}><span></span></button>
	<header class="review-header">
		<div><span class="eyebrow">SYNC / FIXTURE REVIEW</span><h2>Proposed changes</h2></div>
		<div class="review-header-actions">
			<label>SCENARIO
				<select value={proposal.fixture} disabled={loading} onchange={(event) => onFixtureChange(event.currentTarget.value as ReviewFixtureName)}>
					<option value="comprehensive">FULL PROPOSAL</option>
					<option value="large-diff">LARGE DIFF</option>
					<option value="error">ERROR STATE</option>
				</select>
			</label>
			<button class="review-close" aria-label="Close proposal" onclick={onReject}>×</button>
		</div>
	</header>

	{#if loading}
		<div class="review-loading" aria-live="polite"><span></span><strong>PREPARING FIXTURE</strong><small>Assembling a deterministic proposal…</small></div>
	{:else if proposal.status === 'error'}
		<div class="review-error" role="alert">
			<span class="error-code">PROPOSAL / INVALID</span>
			<div class="error-glyph">!</div>
			<h3>{proposal.title}</h3>
			<p>{proposal.message}</p>
			<small>HEAD {proposal.capturedHead.slice(0, 10)} · LIVE REPOSITORY UNCHANGED</small>
			{#if proposal.retryable}<button onclick={() => onFixtureChange('comprehensive')}>LOAD VALID FIXTURE</button>{/if}
		</div>
	{:else}
		<section class="review-overview">
			<div class="review-summary">
				<span class="eyebrow">RECONCILIATION SUMMARY</span>
				<p>{proposal.summary}</p>
			</div>
			<div class="review-metrics" aria-label="Proposal metrics">
				<div><strong>{proposal.operations.length}</strong><span>FILES</span></div>
				<div><strong class="positive">+{additions}</strong><span>ADDED</span></div>
				<div><strong class="negative">−{deletions}</strong><span>REMOVED</span></div>
				<div><strong>{proposal.usage.tokens.total.toLocaleString()}</strong><span>TOKENS</span></div>
			</div>
			<div class="review-notes">
				<details open><summary>ASSUMPTIONS <span>{proposal.assumptions.length}</span></summary><ul>{#each proposal.assumptions as assumption}<li>{assumption}</li>{/each}</ul></details>
				<details open><summary>WARNINGS <span>{proposal.warnings.length}</span></summary><ul class="warnings">{#each proposal.warnings as warning}<li>{warning}</li>{/each}</ul></details>
			</div>
			<div class="model-strip"><span>{proposal.model.provider} / {proposal.model.id}</span><span>${proposal.usage.estimatedCostUsd.toFixed(4)} EST.</span><span>HEAD {proposal.capturedHead.slice(0, 10)}</span></div>
		</section>

		<div class="review-files-and-diff">
			<nav class="affected-files" aria-label="Affected files">
				<header><span>AFFECTED FILES</span><strong>{proposal.operations.length}</strong></header>
				<div class="file-operation-list">
					{#each sourceFiles as file (file.id)}
						<button class:active={selected?.id === file.id} onclick={() => selectedId = file.id}>
							<span class={`operation-kind ${file.kind}`}>{label(file)}</span>
							<strong>{file.path.split('/').at(-1)}</strong>
							<small>{file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}</small>
							<span class="file-totals"><i>+{file.additions}</i><b>−{file.deletions}</b></span>
						</button>
					{/each}
					{#if metadataFiles.length}
						<details class="metadata-group">
							<summary><span>GENERATED METADATA</span><strong>{metadataFiles.length}</strong><small>+{metadataFiles.reduce((sum, file) => sum + file.additions, 0)} −{metadataFiles.reduce((sum, file) => sum + file.deletions, 0)}</small></summary>
							{#each metadataFiles as file (file.id)}
								<button class:active={selected?.id === file.id} onclick={() => selectedId = file.id}><span class={`operation-kind ${file.kind}`}>{label(file)}</span><strong>{file.path.split('/').at(-1)}</strong><small>{file.path}</small></button>
							{/each}
						</details>
					{/if}
				</div>
			</nav>

			<section class="proposal-diff" aria-label="Selected file diff">
				{#if selected}
					<header>
						<div><span class={`operation-kind ${selected.kind}`}>{label(selected)}</span><strong>{selected.path}</strong>{#if selected.oldPath}<small>FROM {selected.oldPath}</small>{/if}</div>
						<span class="diff-totals"><i>+{selected.additions}</i><b>−{selected.deletions}</b></span>
					</header>
					{#if selected.binary}
						<div class="binary-diff"><span>01</span><strong>Binary file</strong><p>A complete text diff is unavailable. The path and operation are included in the reviewed proposal.</p></div>
					{:else}
						<div class="diff-lines" role="textbox" aria-readonly="true" aria-multiline="true" tabindex="0" aria-label={`Complete diff for ${selected.path}`} onkeydown={navigateDiff}>
							{#each selected.diff as line}
								<div class={`diff-line ${line.kind}`}><span>{line.oldLine ?? ''}</span><span>{line.newLine ?? ''}</span><code>{line.text}</code></div>
							{/each}
						</div>
					{/if}
				{/if}
			</section>
		</div>

		<footer class="review-footer">
			<label for="commit-message">COMMIT MESSAGE</label>
			<div class="commit-row"><input id="commit-message" bind:value={commitMessage} spellcheck="false" /><button class="reject" onclick={onReject}>REJECT</button><button class="approve" disabled title="Approval is enabled in Milestone 9">APPROVE &amp; COMMIT</button></div>
			<small>FIXTURE MODE · APPROVAL REMAINS DISABLED IN MILESTONE 6</small>
		</footer>
	{/if}
</aside>
