# Huzzah Desktop Spec

## Product model

Huzzah is a repository-aware text editor that uses AI to synchronize pseudocode with a real implementation.
In this editor there is _spec_ (the pseudocode) and _source_ (the generated source code).
The editor makes a good faith attempt to keep the two in sync, while trying to remain fault tolerant when drift occurs.

## Project configuration

A repository is Huzzah-enabled when it contains `.huzzah/config.json`:

```json
{
  "spec_directory": "hz"
}
```

- `spec_directory` is relative to the repository root and must resolve inside it.
- All `.hz` files beneath that directory, including nested files, are specifications.
- Initialization creates `.huzzah/config.json` and the configured specification directory.

## Editor

- The repository filesystem appears in a tree on the left.
- Open files appear as tabs above the main editor, with one active tab.
- All supported text files are editable.
- Binary and unsupported files are visible but read-only.
- Text changes remain in a clearly marked unsaved buffer until the user invokes Save or Command/Ctrl+S.
- The filesystem is authoritative for saved repository state; unsaved buffers are temporary and require confirmation before being discarded.
- Internal and external filesystem changes are detected automatically.

## Sync availability

- A Sync button appears at the top right.
- Git status is refreshed in the background after filesystem changes settle.
- Sync is enabled when Git reports any added, modified, renamed, or deleted specification relative to `HEAD`.
- All changed specifications are synchronized together.
- Source-only changes do not enable Sync or rewrite specifications.
- A specification change may produce no source changes, but its generated metadata must still be refreshed.
- Sync operates on a captured snapshot. A proposal becomes stale and cannot be approved if relevant files subsequently change.

## Generated metadata

Highlighting and source maps are versioned, committed artifacts stored beneath `.huzzah/generated/`. Artifact paths mirror specification paths.

Each artifact records:

- Its format version.
- The specification path and SHA-256 content hash.
- Semantic highlighting ranges.
- Mapped source paths, their SHA-256 content hashes, and source ranges.

Hashes are computed from UTF-8 text with line endings normalized to `\n`.

- Highlighting is current when the specification hash matches.
- A source map is current only when both the specification hash and every mapped source-file hash match.
- Stale highlighting is hidden and falls back to plain text.
- Stale source mappings are not presented as trustworthy.
- Generated metadata changes are summarized and collapsed by default during review.

## Highlighting

- Sync regenerates semantic highlighting for every changed specification.
- Highlighting runs independently from source reconciliation.
- Highlighting failure does not block synchronization and is shown as a warning with a Retry action.
- A user may regenerate highlighting independently from the editor, file context menu, or command palette.
- Successful independent regeneration updates the corresponding generated artifact on disk.

## Reconciliation

- Sync captures all changed specifications and their Git diffs together.
- The reconciler may read and search the entire repository to understand its architecture, conventions, dependencies, and behavior.
- It may propose creating, modifying, renaming, or deleting files.
- It may not change `.git`, ignored files, or `.huzzah/config.json`.
- Huzzah, rather than the agent, writes generated metadata.
- Reconciliation runs in an isolated workspace or overlay. It does not change the live repository before approval.
- Current source files, including manual edits, are the implementation baseline.
- Manual source changes consistent with the specifications should be preserved.

Every meaningful line of a specification maps to one or more ranges across one or more repository files. Multiple specifications may map to the same source file. Sync regenerates mappings for:

- Every changed specification.
- Every unchanged specification whose existing map targets a proposed source-file change.

## Review

- A resizable review panel opens on the right when a proposal is ready.
- It displays the reconciliation summary, assumptions, warnings, model usage, and affected files.
- Selecting a file displays its diff.
- Created, modified, renamed, and deleted files are clearly distinguished.
- The review shows the complete diff against `HEAD` for everything that will be committed, not only the agent's incremental edits.
- Reject discards the isolated proposal while preserving the user's existing specification and source edits.
- Approve verifies that the captured files have not drifted, then applies the complete proposal atomically.

## Git commit

The primary approval action is **Approve & Commit**.

- Huzzah generates a concise, editable commit message from the reconciliation summary.
- Approval immediately creates a real Git commit, preserving the synchronized-checkpoint invariant.
- The commit contains changed specifications, proposed source operations, generated artifacts, and pre-existing edits within affected source files.
- Unrelated working-tree changes remain uncommitted.
- The user's existing Git staging area remains untouched.
- If application or commit fails, no partial synchronization remains.
