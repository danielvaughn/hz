# Huzzah desktop

Electron shell for the Huzzah editor, built with TypeScript, Svelte, Vite, and Tailwind CSS.

From the repository root:

```sh
npm run dev:electron
```

The Electron main process lives in `src/main`, the isolated preload bridge in `src/preload`, and the Svelte renderer in `src/renderer`.

## Repository editor

The desktop app can open or close a local repository, restore the most recently opened repository, browse its files, and open multiple tabs. Supported UTF-8 text files use CodeMirror and save atomically after a short debounce; unsupported, binary, symlinked, and oversized files remain read-only.

The repository is watched for external creates, renames, edits, and deletions. The tree refreshes automatically, clean tabs reload from disk, and a revision check surfaces an explicit choice instead of overwriting when a file changes while a local edit is pending.

The renderer has no Node or filesystem access. Repository selection, traversal, validation, and reads are exposed through the typed preload API in `src/shared/desktop.ts`.

Keyboard shortcuts:

- `Command/Ctrl + O`: open a repository
- `Command/Ctrl + W`: close the active tab
- `Command/Ctrl + S`: save the active tab immediately
