# Huzzah desktop

Electron shell for the Huzzah editor, built with TypeScript, Svelte, Vite, and Tailwind CSS.

From the repository root:

```sh
npm run dev:electron
```

The Electron main process lives in `src/main`, the isolated preload bridge in `src/preload`, and the Svelte renderer in `src/renderer`.

## Repository editor

The desktop app can open or close a local repository, restore the most recently opened repository, browse its files, and open multiple tabs. Supported UTF-8 text files use CodeMirror and save atomically on `Command/Ctrl + S`; unsupported, binary, symlinked, and oversized files remain read-only. Closing a tab or repository with unsaved edits requires explicit confirmation before those edits are discarded.

The repository is watched for external creates, renames, edits, and deletions. The tree refreshes automatically, clean tabs reload from disk, and a revision check surfaces an explicit choice instead of overwriting when a file changes while a local edit is pending.

The renderer has no Node or filesystem access. Repository selection, traversal, validation, and reads are exposed through the typed preload API in `src/shared/desktop.ts`.

Keyboard shortcuts:

- `Command/Ctrl + O`: open a repository
- `Command/Ctrl + W`: close the active tab
- `Command/Ctrl + S`: save the active tab immediately

## Generated metadata v1

Artifacts mirror the full repository-relative specification path beneath `.huzzah/generated/` and add `.json`. For example, `hz/auth/login.hz` uses `.huzzah/generated/hz/auth/login.hz.json`.

```json
{
  "version": 1,
  "specification": { "path": "hz/auth/login.hz", "hash": "<sha256>" },
  "highlighting": {
    "taxonomyVersion": 1,
    "marks": [{ "from": 0, "to": 5, "category": "action", "text": "Check" }]
  },
  "sourceMaps": [{
    "path": "src/auth/login.ts",
    "hash": "<sha256>",
    "mappings": [{
      "specification": {
        "from": { "line": 1, "column": 0 },
        "to": { "line": 1, "column": 20 }
      },
      "source": [{
        "from": { "line": 10, "column": 0 },
        "to": { "line": 14, "column": 1 }
      }]
    }]
  }]
}
```

Hashes use UTF-8 text after normalizing CRLF and bare CR line endings to LF. Highlighting is usable only while the specification hash matches. Each source-map target is usable only while both its specification and source hashes match. Unknown artifact versions, unsafe paths, invalid hashes, malformed marks, and invalid ranges are rejected rather than exposed to the renderer.
