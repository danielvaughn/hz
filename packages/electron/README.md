# Huzzah desktop

Electron shell for the Huzzah editor, built with TypeScript, Svelte, Vite, and Tailwind CSS.

From the repository root:

```sh
npm run dev:electron
```

The Electron main process lives in `src/main`, the isolated preload bridge in `src/preload`, and the Svelte renderer in `src/renderer`.

## Repository browser

The desktop app can open or close a local repository, restore the most recently opened repository, browse its files, and open multiple read-only file tabs. Closing returns to the welcome screen for the current session without forgetting which repository to restore on the next launch. Supported UTF-8 text files use CodeMirror; unsupported, binary, symlinked, and oversized files receive explicit read-only preview states.

The renderer has no Node or filesystem access. Repository selection, traversal, validation, and reads are exposed through the typed preload API in `src/shared/desktop.ts`.

Keyboard shortcuts:

- `Command/Ctrl + O`: open a repository
- `Command/Ctrl + W`: close the active tab
