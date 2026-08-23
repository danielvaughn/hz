# Huzzah Desktop Implementation Plan

## Goal

Build the Electron scaffold into a repository-aware editor that satisfies `DESKTOP-SPEC.md`. Each milestone should leave the application runnable and introduce one independently testable capability. Risky agent and Git operations come only after the editor, repository, and review foundations work without AI.

## Working principles

- Keep Electron's renderer isolated from Node. Filesystem, Git, agent, and process access live in the main process behind a narrow preload API.
- Treat the filesystem and Git as authoritative. Renderer state is a view of repository state, not a second persistence layer.
- Establish data contracts before adding model behavior. Hashing, metadata validation, proposals, and file operations should be testable with fixtures.
- Never let proposal generation mutate the live repository.
- Reuse focused PoC code where its contracts still fit; do not migrate the PoC's monolithic page state or browser persistence model.

## Target architecture

### Main process

Owns repository selection, configuration, filesystem access, file watching, Git queries, hashing, generated metadata, agent sessions, isolated proposal workspaces, and approval transactions.

### Preload bridge

Exposes typed, task-oriented operations and events. It should not expose raw Node, shell, or arbitrary filesystem APIs.

### Renderer

Owns the editor interface: file tree, tabs, CodeMirror instances, status, Sync controls, highlighting decorations, and review presentation.

### Shared contracts

Keep IPC request, response, event, metadata, proposal, and file-operation types in a shared Electron source directory imported by all three layers.

## Milestone 1: Read-only repository browser

Create the smallest useful desktop editor shell.

- Add an Open Repository action using Electron's directory picker.
- Remember and reopen the most recent repository.
- List repository files in a collapsible tree.
- Open supported text files in tabs and display them with CodeMirror.
- Display binary or unsupported files as read-only.
- Add loading, empty, missing-repository, and file-read error states.
- Keep filesystem access in the main process.

Exit criteria: a user can open a repository, browse it, open several text files, switch tabs, and close tabs.

## Milestone 2: Editing and filesystem synchronization

Turn the browser into a dependable local editor without adding Huzzah behavior yet.

- Make supported text files editable.
- Auto-save changes after a short debounce.
- Write files safely so a failed write does not truncate the original.
- Watch the repository for internal and external changes.
- Refresh the tree when files are created, renamed, or deleted externally.
- Reload an unmodified open tab after an external change.
- Surface a conflict instead of overwriting when a file changes during a pending local save.
- Prevent watcher events caused by Huzzah's own save from producing reload loops.

Exit criteria: files edited in Huzzah and another editor converge on disk without silent data loss.

## Milestone 3: Huzzah project discovery and Git status

Add project semantics without invoking an agent.

- Parse and validate `.huzzah/config.json`.
- Require `spec_directory` to resolve inside the repository.
- Add an initialization action that creates the default config and `hz/` directory.
- Identify nested `.hz` files beneath the configured directory as specifications.
- Query Git status in the background after filesystem activity settles.
- Detect added, modified, renamed, and deleted specifications relative to `HEAD`.
- Add the top-right Sync button and enable it only when specifications changed.
- Show clear states for a non-Git directory, missing `HEAD`, invalid config, and unavailable Git.
- Make Sync open a temporary summary of changed specifications; it does not reconcile yet.

Exit criteria: the Sync button reliably reflects specification changes made inside or outside Huzzah.

## Milestone 4: Generated metadata and drift detection

Implement the deterministic metadata layer before generating real data.

- Define and version the `.huzzah/generated/` artifact schema.
- Mirror specification paths when deriving artifact paths.
- Implement normalized-text SHA-256 hashing.
- Validate artifact structure and reject unsafe or escaping paths.
- Classify highlighting and individual source-map targets as current, stale, missing, or invalid.
- Load current artifacts when opening a specification.
- Hide stale highlighting and mappings in the renderer.
- Add fixtures and unit tests for hashing, path derivation, schema migration boundaries, and drift classification.

Exit criteria: checked-in fixture artifacts load consistently, and editing either spec or mapped source produces the expected stale state.

## Milestone 5: Independent semantic highlighting

Port the smallest useful AI feature from the PoC.

- Reuse the highlighting taxonomy, mark validation, dirty-range logic, and CodeMirror decorations where practical.
- Move model access out of SvelteKit endpoints and into a main-process agent service.
- Add Regenerate Highlighting to the editor, file context menu, and command palette.
- Write successful highlighting into the specification's generated artifact.
- Preserve current source-map data when updating only highlighting.
- Show model details, usage, failures, and Retry without blocking editing.
- Ensure stale or malformed model output cannot corrupt the artifact.

Exit criteria: a user can regenerate, persist, reload, and share semantic highlighting for one specification.

## Milestone 6: Multi-file review without reconciliation

Build and test the review experience using deterministic fixture proposals before connecting it to an agent.

- Define proposal and file-operation contracts for create, modify, rename, and delete.
- Add the resizable right-side review panel.
- Show summary, assumptions, warnings, model usage, and an affected-file list.
- Render complete diffs for all operation types.
- Collapse generated metadata changes into a summary by default.
- Add editable commit-message UI and Approve & Commit / Reject actions.
- Keep approval disabled in this milestone.
- Exercise large diffs, binary paths, renames, deletions, and error states with fixtures.

Exit criteria: every review state can be inspected without an agent or live repository mutation.

## Milestone 7: Isolated multi-file reconciliation

Connect Sync to an agent while retaining a read-only live working tree.

- Capture the repository identity, `HEAD`, changed-spec diffs, relevant file hashes, and current config at Sync start.
- Create an isolated workspace or overlay from that snapshot.
- Give the agent repository read/search capabilities inside the isolated workspace.
- Prevent writes to `.git`, ignored files, and `.huzzah/config.json`.
- Allow proposed source creation, modification, rename, and deletion.
- Treat current source, including manual edits, as the implementation baseline.
- Require a structured response containing a summary, assumptions, file operations, and mappings.
- Derive diffs from the isolated filesystem rather than trusting model-authored patches.
- Leave the live working tree untouched on success, failure, cancellation, or rejection.

Exit criteria: Sync can produce and reject a trustworthy multi-file proposal without changing the live repository.

## Milestone 8: Mapping and metadata reconciliation

Complete the proposal by generating all metadata required by the spec.

- Map every meaningful changed-spec line to one or more ranges in one or more resulting repository files.
- Find unchanged specifications whose existing maps target a proposed source change.
- Regenerate those affected mappings as part of the same proposal.
- Validate mapped paths, ranges, spec hashes, and resulting source hashes.
- Generate updated artifact files through Huzzah code, not agent file operations.
- Run semantic highlighting for changed specs in parallel with reconciliation.
- Allow highlighting to fail without blocking the proposal; show a warning and Retry.
- Permit a valid proposal with no source changes when metadata still needs refresh.

Exit criteria: approving the displayed proposal would leave every affected mapping current, even when multiple specs share a source file.

## Milestone 9: Staleness and approval transaction

Make review approval safe before enabling real commits.

- Recheck `HEAD`, config, affected paths, and captured hashes immediately before approval.
- Mark the proposal stale and disable approval on any relevant drift.
- Define the exact synchronized set: changed specs, proposed source operations, generated artifacts, and pre-existing edits within affected source files.
- Build the reviewed tree with a temporary Git index so unrelated worktree and staged changes are excluded.
- Preserve the user's existing index exactly.
- Generate an editable default commit message from the proposal summary.
- Run all preflight checks before changing the live working tree or branch reference.
- Apply the reviewed files and create the Git commit as one recoverable transaction.
- Roll back files, index state, and refs if any step fails.
- Make Reject remove all temporary proposal state while preserving existing user edits.

Exit criteria: Approve & Commit creates exactly the reviewed commit, unrelated changes remain untouched, and injected failures leave no partial synchronization.

## Milestone 10: Recovery and production hardening

Make the full workflow resilient enough for sustained use.

- Recover or clean up interrupted isolated workspaces and incomplete transactions on launch.
- Handle repository moves, deleted branches, detached `HEAD`, branch switches, and external commits.
- Add cancellation and timeouts for highlighting and reconciliation.
- Bound file counts, file sizes, diff sizes, model context, and output sizes with clear errors.
- Redact secrets from logs and avoid logging repository contents by default.
- Test symlinks and path traversal across every filesystem boundary.
- Add keyboard navigation, accessible focus behavior, and reduced-motion handling.
- Add end-to-end tests for initialization, external edits, Sync, stale proposals, Reject, and Approve & Commit.
- Update root scripts and documentation so the desktop app becomes the primary development path.

Exit criteria: the complete spec workflow survives process interruption, external filesystem activity, and common Git edge cases without repository corruption.

## PoC reuse guide

Likely reusable with adaptation:

- Highlight taxonomy, validation, and CodeMirror decoration logic.
- Source-map range types and normalization concepts.
- Inference model and usage reporting.
- Reconciliation response validation and timeout patterns.
- Review summary and assumptions presentation.

Replace rather than migrate directly:

- SvelteKit API endpoints.
- LocalForage workspace persistence.
- The single-document project and commit model.
- The single-source review flow.
- The browser Web Worker REPL, unless it becomes a separate desktop feature later.

## Decisions to settle before their milestones

These do not block the early editor milestones:

- Supported text/binary detection rules and maximum editable file size.
- Exact generated-artifact JSON schema and migration policy.
- Model/provider configuration and credential ownership.
- Agent command-execution permissions, if any; the initial reconciliation can use read/search and file operations only.
- Validation commands to run against an isolated proposal before review or approval.
- Git hook behavior during Approve & Commit.
- Whether generated-only working-tree changes should receive a dedicated metadata commit action.
