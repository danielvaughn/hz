# Huzzah

An experimental interface for building software by editing persistent pseudocode and synchronizing it with an AI-generated implementation.

This repository is an npm workspace monorepo:

- `packages/hz` contains the existing SvelteKit application.
- `packages/electron` contains the Electron desktop application built with Svelte and Tailwind CSS.

## setup

You need Node.js 22.19 or newer and access to a model provider supported by [Pi](https://github.com/earendil-works/pi).

1. `git clone https://github.com/danielvaughn/hz.git`
2. `cd hz`
3. `npm install`
4. Configure Pi using one of the options below.
5. `npm run dev`

Open the url (should run on `http://localhost:5173`)

## configure Pi

Huzzah uses Pi's provider, credential, and model configuration.
It does not require a particular model vendor.

### authenticate with an API key

Set an environment variable supported by your provider before starting Huzzah.
For example:

```sh
export ANTHROPIC_API_KEY=sk-ant-...
```

Pi also recognizes credentials for OpenAI, Google, Azure OpenAI, Amazon Bedrock, and other supported providers.

### authenticate with a subscription

Run Pi through the local project installation:

```sh
npx pi
```

Enter `/login`, choose a provider, and complete its authentication flow. Exit Pi when authentication is complete, then start Huzzah with `npm run dev`.

### choose a model

Set Pi's default provider and model in `~/.pi/agent/settings.json`:

```json
{
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-5"
}
```

Use model IDs available to your configured provider. If no default is set, Pi falls back to the first authenticated model it finds. Huzzah currently uses Pi's `low` thinking level for reconciliation and semantic highlighting regardless of `defaultThinkingLevel`.

Pi also supports custom providers and local models such as Ollama, LM Studio, and vLLM through [`~/.pi/agent/models.json`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md).

Do not paste secrets or private source into Huzzah. Specs and current generated source are sent to your selected model provider, and accepted AI-generated JavaScript runs locally in a Web Worker. This is experimental containment, not a hostile-code sandbox.

## ideas to get started

- A shopping cart that applies discounts, taxes, and free-shipping rules.
- A task scheduler that prioritizes work by urgency, effort, and deadline.
- A text formatter that converts rough notes into consistent Markdown.
- A turn-based combat system with characters, attacks, armor, and status effects.
- A personal budget that categorizes transactions and warns about overspending.
- A recommendation engine that ranks movies from a user’s stated preferences.
- A rate limiter with configurable request windows and per-user allowances.
- A meeting-room allocator that resolves scheduling conflicts and capacity requirements.
- A data validator that checks signup forms and returns useful error messages.
- A word game that scores guesses and tracks state across multiple turns.
