# hz prototype plan

## Product thesis

Coding agents currently turn ephemeral human prompts into persistent source code. The implementation survives, but much of the intent that produced it does not.

`hz` explores a different authoring model: the developer directly edits a persistent, pseudocode-like description of the software, and an agent reconciles the implementation with each change.

The pseudocode can use whatever form is natural to the developer. It is not a formal programming language in this prototype. Its meaning emerges from the document, its history, and the implementation it describes.

The central interaction is not chatting with an agent. It is editing the program's intent.

## Core model

The system maintains two synchronized documents:

1. **Intent**: developer-authored pseudocode describing the desired program.
2. **Source**: agent-produced JavaScript implementing that intent.

A commit reconciles a change in intent with the current source:

```text
committed intent + intent diff + committed source
                         |
                         v
                   proposed source
                         |
                    user accepts
                         |
                         v
              new synchronized commit
```

The important invariant is:

> Every committed intent state has a corresponding committed implementation state.

Until a proposed implementation is accepted, the previous intent and source remain the committed pair.

## Prototype question

The prototype should answer one question:

> Does editing persistent pseudocode feel meaningfully better than prompting a coding agent?

It does not need to prove that arbitrary applications can be generated, replace Git, or support production software development.

## Experience

The application is a two-column SvelteKit web app.

```text
+--------------------------------+--------------------------------+
| Intent                         | Source | REPL                  |
|                                |                                |
| CodeMirror editor              | Generated JavaScript or        |
|                                | interactive program output     |
|                                |                                |
|                       [Commit] | > program.example()            |
+--------------------------------+--------------------------------+
```

### Intent editor

- CodeMirror editor with no required language or grammar.
- Draft changes are saved continuously in the browser.
- The UI clearly distinguishes clean and uncommitted intent.
- The Commit button becomes available when the draft differs from the committed intent.
- The displayed diff is computed from committed and draft snapshots, not from CodeMirror's transient edit history.

### Reconciliation

Pressing Commit:

1. Computes the difference between committed and draft intent.
2. Sends the previous intent, next intent, intent diff, and current source to the server.
3. Runs Pi with a narrowly scoped reconciliation task.
4. Produces a complete proposed version of the JavaScript source.
5. Shows the proposed source and its diff for review.
6. Lets the user accept or reject the proposal.

Accepting the proposal atomically promotes both the draft intent and proposed source to the new committed state. Rejecting it preserves the previous committed pair and leaves the intent draft available for editing or retrying.

The prototype should use words such as **commit**, **reconcile**, and **review**, rather than chat-oriented language such as **send** or **message**.

### Source view

- Displays the current committed JavaScript by default.
- During review, displays the proposed JavaScript and its changes from the committed source.
- Source is read-only in the first version.
- Pi returns a complete source document rather than a patch; the application computes the source diff for presentation.

### REPL

The REPL is for exploring current behavior, not instructing the agent.

- Accepted source is loaded as an ES module in a Web Worker.
- Module exports are exposed under a `program` namespace.
- The user can evaluate synchronous and asynchronous expressions.
- Console output, returned values, and errors are displayed.
- The runtime persists between commands.
- A `repl` object provides persistent user-controlled references between commands.
- Reset terminates the worker and reloads committed source.
- Accepting a new commit also resets the runtime.
- Execution has a timeout so runaway programs can be terminated.

Example:

```javascript
program.fizzBuzz(20)
await program.fetchUser("123")
repl.cart = program.createCart()
repl.cart.add("apple")
```

The first version is an expression-oriented REPL. It does not need to reproduce browser DevTools or preserve arbitrary lexical declarations between commands.

## Generated-source contract

Pi generates one JavaScript ES module. Useful operations should be named exports:

```javascript
export function add(a, b) {
  return a + b;
}
```

The REPL exposes the module as:

```javascript
program.add(2, 3)
```

Programs that have an entry point should export `main`; it will not run automatically:

```javascript
export function main() {
  console.log("Hello");
}
```

The REPL can then suggest `program.main()` after loading.

## Architecture

### Client

- SvelteKit user interface.
- CodeMirror for intent editing and REPL input.
- LocalForage for project and commit persistence.
- A diff library for intent and source comparisons.
- A disposable Web Worker for JavaScript execution.

### Server

- A SvelteKit server endpoint embeds Pi through its Node SDK.
- Model credentials remain server-side.
- The server is stateless for the prototype; the client sends the full reconciliation context with every request.
- Pi receives a constrained virtual workspace rather than general access to the host repository.
- Agent progress may be streamed to the client, but a conversational UI is not required.

### Reconciliation request

```typescript
type ReconcileRequest = {
  previousIntent: string;
  nextIntent: string;
  intentDiff: string;
  currentSource: string;
};
```

The response should contain at least:

```typescript
type ReconcileResponse = {
  proposedSource: string;
  summary: string;
  assumptions: string[];
};
```

Assumptions must be visible during review because they are places where the agent may otherwise silently author product intent.

## Persistence

LocalForage stores a single project and a lightweight history of accepted commits.

```typescript
type Project = {
  draftIntent: string;
  committedIntent: string;
  committedSource: string;
  proposedSource: string | null;
  status: "clean" | "dirty" | "generating" | "reviewing" | "error";
  commits: Commit[];
};

type Commit = {
  id: string;
  createdAt: string;
  intent: string;
  intentDiff: string;
  source: string;
};
```

The initial implementation only needs one project. Commit history supports inspecting and restoring synchronized checkpoints without requiring Git.

## Primary states

The interface should make system state unambiguous:

- **Clean**: draft intent and committed intent match.
- **Uncommitted intent**: the developer has edited intent.
- **Reconciling**: Pi is producing a proposed implementation.
- **Reviewing**: a proposed source change is waiting for acceptance.
- **Error**: reconciliation or execution failed without altering the committed pair.

Closing or refreshing the browser must not lose the intent draft, committed pair, or pending proposal.

## Safety boundary

Generated JavaScript must not execute in the SvelteKit application's main window.

For the prototype it runs in a disposable Web Worker, which limits DOM access and allows termination. This is containment, not a complete security sandbox. The prototype should not claim that executing hostile JavaScript is safe.

## Milestones

### 1. Local editing shell

- Create the SvelteKit application and two-column layout.
- Integrate CodeMirror for intent editing.
- Persist draft and committed state with LocalForage.
- Compute dirty state and intent diffs.
- Add Source and REPL tabs with placeholder content.

### 2. Reconciliation

- Add the SvelteKit reconciliation endpoint.
- Integrate Pi on the server.
- Send complete reconciliation context.
- Receive and display proposed JavaScript.
- Add source diff review, acceptance, and rejection.
- Persist accepted synchronized commits.

### 3. Runtime and REPL

- Load committed JavaScript in a Web Worker.
- Expose module exports as `program`.
- Evaluate async expressions and capture console output.
- Format returned values and errors.
- Add command history, reset, and execution timeout.
- Reset the runtime after accepting a commit.

### 4. Prototype refinement

- Make reconciliation states visually unmistakable.
- Surface agent assumptions during review.
- Add commit history and restore.
- Add useful empty states and an example intent program.
- Verify persistence across reloads and failures.

## Non-goals

The first version will not include:

- Git integration.
- Multiple projects or generated files.
- Direct editing of generated source.
- Guided human implementation.
- An agent chat interface.
- Agent memory between commits.
- Package installation or arbitrary imports.
- DOM or graphical program output.
- Authentication, cloud persistence, or collaboration.
- A formal pseudocode grammar.
- Automatic acceptance of generated changes.
- A full JavaScript console or debugger.
- A production-grade hostile-code sandbox.

## Success criteria

The prototype succeeds if a developer can:

1. Describe a small JavaScript program in their own pseudocode.
2. Commit that intent and review the proposed implementation.
3. Accept the implementation as a synchronized checkpoint.
4. Exercise it repeatedly through the REPL.
5. Discover a behavioral problem, revise the pseudocode, and commit again.
6. Understand at all times which intent and source are committed, proposed, or unsynchronized.

The qualitative test is whether this loop feels like editing a program rather than repeatedly explaining changes to an assistant.
