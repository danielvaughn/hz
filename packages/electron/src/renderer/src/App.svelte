<script lang="ts">
	const platform = window.desktop.platform;
</script>

<svelte:head>
	<title>Huzzah</title>
</svelte:head>

<main class="grid min-h-screen place-items-center bg-zinc-950 px-6 text-zinc-100">
	<section class="max-w-xl text-center">
		<h1 class="text-4xl font-semibold tracking-tight sm:text-5xl">Electron</h1>
		<p class="mt-5 text-base leading-7 text-zinc-400">
			Electron, Svelte, TypeScript, and Tailwind are wired up. Running on {platform}.
		</p>
	</section>
</main>
